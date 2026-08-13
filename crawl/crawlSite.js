// Multi-page site crawl — composes three existing pieces of the engine that
// hadn't been tied together before this module existed:
//   1. crawl/discover.js    — generic (site-agnostic) link discovery
//   2. core/worker-loop.js  — checkpointed, rate-limited, retryable job execution
//   3. extraction/auto.js   — the tiered per-page extraction pipeline
//
// No site-specific code anywhere in this file — it works the same way
// against any site. Raw deterministic visible text is captured per page
// alongside the schema-shaped extraction result, specifically so the corpus
// this produces is never solely dependent on LLM paraphrasing — see
// "why raw text is captured separately" below.

const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { discoverPages } = require('./discover');
const { autoExtract } = require('../extraction/auto');
const { runWorkerPool } = require('../core/worker-loop');
const { fetchHtml } = require('../transports/http');
const { htmlToText } = require('../extraction/html-to-text');

function defaultCheckpointDir(seed) {
    const hash = crypto.createHash('md5').update(seed).digest('hex').slice(0, 12);
    return path.join(os.tmpdir(), 'chiselforge-crawl', hash);
}

/**
 * Crawls a site starting from `seed`, discovering same-origin pages and
 * running each one through the tiered autoExtract pipeline.
 *
 * @param {string} seed
 * @param {object} schema                 Passed to autoExtract for every page — see extraction/auto.js
 * @param {object} [options]
 * @param {number} [options.maxPages=50]
 * @param {number} [options.workers=3]
 * @param {number} [options.delayMs=200]   Politeness delay during link discovery
 * @param {string} [options.checkpointDir] Defaults to a per-seed temp dir (resumable across runs with the same seed unless overridden)
 * @param {number} [options.maxRetries=1]
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
        checkpointDir = defaultCheckpointDir(seed),
        maxRetries = 1,
        extractOptions = {},
        onProgress = () => {},
    } = options;

    onProgress('discovering', { seed });
    const discovery = await discoverPages(seed, {
        maxPages, delayMs,
        onPage: (url, count) => onProgress('discovery-page', { url, count }),
    });
    onProgress('discovered', {
        pageCount: discovery.pages.length,
        sitemapPageCount: discovery.sitemapPageCount,
        crawledPageCount: discovery.crawledPageCount,
    });

    const jobs = discovery.pages.map(url => ({ url }));
    const pageResults = new Map();

    await runWorkerPool({
        jobs,
        workerCount: Math.max(1, workers),
        getCheckpointKey: job => job.url,
        checkpointDir,
        maxRetries,
        delayBetweenJobsMinMs: delayMs,
        delayBetweenJobsMaxMs: delayMs + 300,
        processJob: async (job) => {
            onProgress('page-start', { url: job.url });
            const warnings = [];

            let html;
            try {
                html = (await fetchHtml(job.url, { timeoutMs: 20000 })).html;
            } catch (err) {
                pageResults.set(job.url, {
                    url: job.url, title: null, rawText: '', data: [],
                    strategy: null, llmUsed: null, browserUsed: null, confidence: null,
                    warnings, error: `fetch failed: ${err.message}`,
                });
                throw err; // let runWorkerPool's retry/checkpoint logic handle it
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
                extraction = await autoExtract(job.url, schema, { ...extractOptions, html });
            } catch (err) {
                warnings.push(`extraction failed: ${err.message}`);
                pageResults.set(job.url, {
                    url: job.url, title, rawText, data: [],
                    strategy: null, llmUsed: null, browserUsed: null, confidence: null,
                    warnings, error: err.message,
                });
                onProgress('page-error', { url: job.url, error: err.message });
                throw err;
            }

            pageResults.set(job.url, {
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

    const pages = discovery.pages.map(url => pageResults.get(url) || {
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
