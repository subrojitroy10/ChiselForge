// Multi-page site crawl — composes three existing pieces of the engine that
// hadn't been tied together before this module existed:
//   1. crawl/discover.js    — generic (site-agnostic) link discovery
//   2. core/worker-loop.js  — checkpointed, rate-limited, retryable job execution
//   3. extraction/auto.js   — the tiered per-page extraction pipeline
//
// No site-specific code anywhere in this file — it works the same way
// against any site. Raw deterministic source text is captured per page
// alongside the schema-shaped extraction result, specifically so the corpus
// this produces is never solely dependent on LLM paraphrasing — see
// "why raw text is captured separately" below.

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { discoverPages } = require('./discover');
const { autoExtract } = require('../extraction/auto');
const { runWorkerPool } = require('../core/worker-loop');
const { fetchHtml } = require('../transports/http');
const { htmlToText } = require('../extraction/html-to-text');
const { classifyHtml } = require('../extraction/classify');

// Real bug found via live testing (crawling stron.in twice in a row):
// checkpointDir used to default to a hash of the seed URL ALONE, so two
// unrelated CLI invocations against the same URL silently shared state.
// The second run saw the first run's successful pages as "already
// checkpointed" and skipped reprocessing them — correct resumability
// behavior in isolation — but crawlSite only ever persisted a boolean
// "done" marker (via core/checkpoint.js), never the actual extracted data,
// so the second run's report had nothing to show for those skipped pages
// and incorrectly listed them as failed/unprocessed. Fixed two ways:
// 1. The default checkpointDir is now unique per invocation (timestamp +
//    random), so accidental cross-run state sharing can't happen unless a
//    caller deliberately passes the same checkpointDir on purpose.
// 2. Per-page results are now persisted to disk (not just an in-memory Map)
//    specifically so that a deliberately-reused checkpointDir produces a
//    correct report for skipped/already-done pages too.
function defaultCheckpointDir() {
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    return path.join(os.tmpdir(), 'chiselforge-crawl', unique);
}

function resultFilePath(checkpointDir, url) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return path.join(checkpointDir, 'results', `${hash}.json`);
}

function persistResult(checkpointDir, url, result) {
    const filePath = resultFilePath(checkpointDir, url);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(result));
}

function loadPersistedResult(checkpointDir, url) {
    const filePath = resultFilePath(checkpointDir, url);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (_) {
        return null;
    }
}

/**
 * Crawls a site starting from `seed`, discovering same-host pages and
 * running each one through the tiered autoExtract pipeline.
 *
 * @param {string} seed
 * @param {object} schema                 Passed to autoExtract for every page — see extraction/auto.js
 * @param {object} [options]
 * @param {number} [options.maxPages=50]
 * @param {number} [options.workers=3]
 * @param {number} [options.delayMs=200]   Politeness delay during link discovery
 * @param {string} [options.checkpointDir]
 *        Defaults to a unique temp dir PER CALL — safe by default, but NOT
 *        resumable across separate invocations unless you explicitly pass
 *        the same path back in on a later call. Per-page results are
 *        persisted to disk here (not just tracked in memory), so a
 *        deliberately-reused checkpointDir correctly reports previously-
 *        completed pages, not just "already done, no data available."
 * @param {number} [options.maxRetries=1]
 * @param {number} [options.errorBackoffMinMs]
 *        Forwarded to runWorkerPool (core/worker-loop.js) — delay after a
 *        failed page, before retrying/continuing. Defaults to
 *        runWorkerPool's own default (20-40s) if not set; mainly useful to
 *        turn down in tests that exercise retry behavior.
 * @param {number} [options.errorBackoffMaxMs]
 * @param {boolean} [options.respectRobots=true]
 *        On by default — see crawl/discover.js's discoverPages for what this
 *        does. Set false to disable robots.txt filtering entirely.
 * @param {object} [options.extractOptions] Forwarded to every autoExtract() call — apiKey, baseUrl, model, jsonLdType, instructions, etc.
 * @param {(event:string, detail?:object)=>void} [options.onProgress]
 * @returns {Promise<{
 *   seed: string,
 *   pagesDiscovered: number,
 *   discoveryFailures: Array<{url:string, error:string}>,
 *   pagesExtracted: number,
 *   pagesFailed: number,
 *   pages: Array<{
 *     url: string, title: string|null, rawText: string,
 *     data: any[], strategy: string|null, llmUsed: boolean|null,
 *     browserUsed: boolean|null, confidence: number|null,
 *     warnings: string[], error: string|null,
 *   }>,
 * }>}
 */
async function crawlSite(seed, schema, options = {}) {
    const {
        maxPages = 50,
        workers = 3,
        delayMs = 200,
        checkpointDir = defaultCheckpointDir(),
        maxRetries = 1,
        errorBackoffMinMs,
        errorBackoffMaxMs,
        respectRobots = true,
        extractOptions = {},
        onProgress = () => {},
    } = options;

    onProgress('discovering', { seed });
    const discovery = await discoverPages(seed, {
        maxPages, delayMs, respectRobots,
        onPage: (url, count) => onProgress('discovery-page', { url, count }),
        renderWithBrowser: extractOptions.renderWithBrowser,
        renderOnBlock: extractOptions.renderOnBlock,
    });
    onProgress('discovered', {
        pageCount: discovery.pages.length,
        sitemapPageCount: discovery.sitemapPageCount,
        crawledPageCount: discovery.crawledPageCount,
        robotsDisallowedCount: discovery.robotsDisallowedCount,
    });

    const jobs = discovery.pages.map(url => ({ url }));
    const pageResults = new Map();

    function setResult(url, result) {
        pageResults.set(url, result);
        persistResult(checkpointDir, url, result);
    }

    await runWorkerPool({
        jobs,
        workerCount: Math.max(1, workers),
        getCheckpointKey: job => job.url,
        checkpointDir,
        maxRetries,
        delayBetweenJobsMinMs: delayMs,
        delayBetweenJobsMaxMs: delayMs + 300,
        errorBackoffMinMs,
        errorBackoffMaxMs,
        processJob: async (job) => {
            onProgress('page-start', { url: job.url });
            const warnings = [];

            let html;
            let httpStatus;
            try {
                const fetched = await fetchHtml(job.url, {
                    timeoutMs: 20000,
                    allowBotBlockFallback: extractOptions.renderOnBlock,
                });
                html = fetched.html;
                httpStatus = fetched.status;
            } catch (err) {
                setResult(job.url, {
                    url: job.url, title: null, rawText: '', data: [],
                    strategy: null, llmUsed: null, browserUsed: null, confidence: null,
                    warnings, error: `fetch failed: ${err.message}`,
                });
                throw err; // let runWorkerPool's retry/checkpoint logic handle it
            }

            // Real gap found and fixed: rawText used to be captured from the
            // PRE-render fetch only, so browser-rendered pages (a Vite/React
            // SPA, e.g.) got a ~40-character empty-shell rawText even though
            // the schema-shaped `data` field had real rendered content —
            // found by inspecting real crawl output against stron.in, not
            // hypothetical. Resolve rendering HERE, before capturing rawText,
            // so it reflects whatever content autoExtract will actually see.
            // The resolved html is then passed into autoExtract via
            // options.html so it doesn't re-render a second time.
            let browserUsed = false;
            if (classifyHtml(html, { status: httpStatus }).needsBrowser && extractOptions.renderWithBrowser) {
                try {
                    html = await extractOptions.renderWithBrowser(job.url);
                    browserUsed = true;
                } catch (err) {
                    // Real gap: this call used to be unguarded, so a thrown
                    // renderWithBrowser (a crashed/misbehaving renderer, not
                    // just a bot-block) propagated straight out of
                    // processJob without ever calling setResult() for this
                    // URL — pageResults had no entry and nothing was
                    // persisted, so the final report fell through to the
                    // generic "not processed (worker pool did not report a
                    // result)" fallback below, losing the actual reason.
                    // Persist the real failure before rethrowing so
                    // runWorkerPool's retry/checkpoint logic still runs
                    // normally — a later successful retry's setResult()
                    // overwrites this one, same as the fetch-failure case
                    // just above.
                    warnings.push(`render failed: ${err.message}`);
                    setResult(job.url, {
                        url: job.url, title: null, rawText: '', data: [],
                        strategy: null, llmUsed: null, browserUsed: null, confidence: null,
                        warnings, error: `render failed: ${err.message}`,
                    });
                    onProgress('page-error', { url: job.url, error: `render failed: ${err.message}` });
                    throw err; // let runWorkerPool's retry/checkpoint logic handle it
                }
            }

            // Raw deterministic text — never LLM-paraphrased, always captured
            // regardless of which extraction tier fires below. This is what
            // makes the corpus a genuine raw record rather than solely an
            // LLM's interpretation of the page.
            const rawText = htmlToText(html);
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

            let extraction;
            try {
                extraction = await autoExtract(job.url, schema, { ...extractOptions, html, browserUsed });
            } catch (err) {
                warnings.push(`extraction failed: ${err.message}`);
                setResult(job.url, {
                    url: job.url, title, rawText, data: [],
                    strategy: null, llmUsed: null, browserUsed: null, confidence: null,
                    warnings, error: err.message,
                });
                onProgress('page-error', { url: job.url, error: err.message });
                throw err;
            }

            setResult(job.url, {
                url: job.url,
                title,
                rawText,
                data: extraction.data,
                strategy: extraction.extraction.strategy,
                llmUsed: extraction.extraction.llmUsed,
                browserUsed: extraction.extraction.browserUsed,
                confidence: extraction.extraction.confidence,
                warnings,
                error: null,
            });
            onProgress('page-done', {
                url: job.url,
                strategy: extraction.extraction.strategy,
                llmUsed: extraction.extraction.llmUsed,
            });
            return extraction;
        },
    });

    // Pages skipped by runWorkerPool because they were already checkpointed
    // as complete (a deliberately-reused checkpointDir) never call
    // processJob at all in this run, so they're missing from the in-memory
    // pageResults Map even though they genuinely succeeded — check the
    // persisted-to-disk result before falling back to "not processed."
    const pages = discovery.pages.map(url =>
        pageResults.get(url) ||
        loadPersistedResult(checkpointDir, url) || {
            url, title: null, rawText: '', data: [],
            strategy: null, llmUsed: null, browserUsed: null, confidence: null,
            warnings: [], error: 'not processed (worker pool did not report a result)',
        });

    return {
        seed,
        pagesDiscovered: discovery.pages.length,
        discoveryFailures: discovery.failures,
        pagesExtracted: pages.filter(p => !p.error).length,
        pagesFailed: pages.filter(p => p.error).length,
        pages,
    };
}

module.exports = { crawlSite };
