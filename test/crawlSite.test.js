// End-to-end crawlSite() test against a local 3-page fixture site — proves
// discovery (link crawl) + extraction (JSON-LD tier, no LLM needed since
// every fixture page carries relevant JSON-LD) + report generation all work
// together, fully offline and deterministic. Live-site crawling and the LLM
// tiers are exercised separately in benchmark/ (real network, real cost —
// see docs/benchmarks.md), kept out of the committed test suite intentionally.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { crawlSite } = require('../crawl/crawlSite');
const { startLocalServer } = require('../benchmark/local-server');

test('crawls a local multi-page site, extracts every page via JSON-LD (no LLM), reports accurately', async () => {
    const server = await startLocalServer(path.join(__dirname, 'fixtures', 'mini-site'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-test-'));

    try {
        const result = await crawlSite(server.url('index.html'), { title: 'string', description: 'string' }, {
            maxPages: 10,
            workers: 2,
            delayMs: 0,
            checkpointDir,
        });

        assert.equal(result.pagesDiscovered, 3, `expected 3 pages (index, about, contact), got ${result.pagesDiscovered}: ${result.pages.map(p => p.url).join(', ')}`);
        assert.equal(result.pagesExtracted, 3);
        assert.equal(result.pagesFailed, 0);

        for (const page of result.pages) {
            assert.equal(page.strategy, 'json-ld', `page ${page.url} should use json-ld tier`);
            assert.equal(page.llmUsed, false, `page ${page.url} should not need an LLM`);
            assert.ok(page.rawText.length > 0, `page ${page.url} should have raw text captured`);
            assert.ok(page.title, `page ${page.url} should have a title`);
            assert.equal(page.data.length, 1);
            assert.equal(page.error, null);
        }

        const homePage = result.pages.find(p => p.url.endsWith('index.html'));
        assert.equal(homePage.data[0].title, 'Home Page');
        assert.ok(homePage.rawText.includes('Welcome'));
    } finally {
        await server.close();
    }
});

test('resuming a crawl against the same checkpointDir skips already-completed pages', async () => {
    const server = await startLocalServer(path.join(__dirname, 'fixtures', 'mini-site'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-resume-'));

    try {
        await crawlSite(server.url('index.html'), { title: 'string' }, {
            maxPages: 10, workers: 2, delayMs: 0, checkpointDir,
        });

        const { loadCompletedKeys } = require('../core/checkpoint');
        const completed = loadCompletedKeys(checkpointDir);
        assert.equal(completed.size, 3);
    } finally {
        await server.close();
    }
});

// Regression test for a real bug found crawling stron.in twice: checkpointDir
// used to default to a hash of the seed URL alone, so two unrelated
// invocations against the same URL silently shared state, and the second
// run reported the first run's successful pages as "not processed" (no
// persisted data existed to report, only a boolean checkpoint marker).
test('two separate crawlSite() calls against the same seed with no explicit checkpointDir do not share state', async () => {
    const server = await startLocalServer(path.join(__dirname, 'fixtures', 'mini-site'));
    try {
        const first = await crawlSite(server.url('index.html'), { title: 'string' }, {
            maxPages: 10, workers: 2, delayMs: 0,
            // no checkpointDir supplied — exercises the default
        });
        assert.equal(first.pagesExtracted, 3);

        const second = await crawlSite(server.url('index.html'), { title: 'string' }, {
            maxPages: 10, workers: 2, delayMs: 0,
            // no checkpointDir supplied again — must NOT see the first call's state
        });
        assert.equal(second.pagesExtracted, 3, 'second call should process all 3 pages fresh, not see them as already done with no data');
        for (const page of second.pages) {
            assert.equal(page.error, null, `page ${page.url} should have succeeded, not be reported as unprocessed`);
        }
    } finally {
        await server.close();
    }
});

// Regression test for a real gap found inspecting actual stron.in crawl
// output: rawText used to be captured from the PRE-render fetch only, so a
// browser-rendered page's rawText was just the ~40-character empty-shell
// title, even though the schema-shaped `data` field had real rendered
// content. Fixed by resolving rendering before capturing rawText.
test('rawText reflects rendered content for a page that needed a browser, not the pre-render empty shell', async () => {
    // Includes matching JSON-LD so extraction succeeds via the deterministic
    // tier 1 — no LLM/API key needed, keeping this test offline and isolating
    // the actual concern (rawText fidelity) from LLM retry mechanics. An
    // earlier version of this test used LLM-tier-only content with no API
    // key supplied, which failed and retried, calling renderWithBrowser
    // twice — correct retry behavior, but it made the test's own expectation
    // wrong, not the fix under test. Found by writing a standalone debug
    // script when the assertion failed unexpectedly.
    const RENDERED_HTML = `<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Wireless Keyboard Pro"}</script>
<div id="root"><h1>Wireless Keyboard Pro</h1><p>A great keyboard, genuinely in stock.</p></div>
</body></html>`;
    const server = await startLocalServer(path.join(__dirname, '..', 'benchmark', 'fixtures'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-rendered-rawtext-'));

    try {
        let renderCallCount = 0;
        const renderWithBrowser = async () => { renderCallCount++; return RENDERED_HTML; };

        const result = await crawlSite(server.url('spa-product.html'), { name: 'string' }, {
            maxPages: 1, workers: 1, delayMs: 0, checkpointDir,
            extractOptions: { renderWithBrowser },
        });

        assert.equal(result.pagesExtracted, 1);
        const page = result.pages[0];
        assert.equal(page.error, null);
        assert.ok(page.rawText.includes('Wireless Keyboard Pro'), `rawText should contain real rendered content, got: ${JSON.stringify(page.rawText)}`);
        assert.ok(page.rawText.includes('genuinely in stock'), 'rawText should contain the full rendered paragraph, not just a title');
        assert.ok(!page.rawText.startsWith('SPA Test Page') || page.rawText.length > 20, 'rawText should not be just the pre-render shell title');

        // The browser should only render once — crawlSite resolves rendering
        // itself and passes the result into autoExtract via options.html,
        // which must not trigger a second render internally.
        assert.equal(renderCallCount, 1, 'page should only be rendered once, not twice');
    } finally {
        await server.close();
    }
});

// Regression test: crawlSite() resolves browser rendering itself (see above)
// and hands the already-rendered HTML to autoExtract via options.html.
// autoExtract only used to set extraction.browserUsed = true when IT called
// renderWithBrowser directly — since the HTML it received here was already
// rendered (and the resolved HTML itself no longer needsBrowser), that
// branch never ran, so a page that genuinely required a browser was
// reported with browserUsed: false. Fixed by crawlSite passing
// options.browserUsed through to autoExtract when it did the pre-render.
test('a page that required browser rendering reports browserUsed: true, not false', async () => {
    const RENDERED_HTML = `<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Wireless Keyboard Pro"}</script>
<div id="root"><h1>Wireless Keyboard Pro</h1><p>Rendered content.</p></div>
</body></html>`;
    const server = await startLocalServer(path.join(__dirname, '..', 'benchmark', 'fixtures'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-browserused-'));

    try {
        const result = await crawlSite(server.url('spa-product.html'), { name: 'string' }, {
            maxPages: 1, workers: 1, delayMs: 0, checkpointDir,
            extractOptions: { renderWithBrowser: async () => RENDERED_HTML },
        });

        assert.equal(result.pagesExtracted, 1);
        assert.equal(result.pages[0].error, null);
        assert.equal(result.pages[0].browserUsed, true, 'a page that genuinely required browser rendering must report browserUsed: true');
    } finally {
        await server.close();
    }
});

// Regression test for a real gap: the renderWithBrowser() call inside
// crawlSite.js's processJob was unguarded — a thrown renderer ("renderer
// exploded") propagated straight out of processJob without ever calling
// setResult() for that URL. With no entry in pageResults and nothing
// persisted, the final report fell through to the generic "not processed
// (worker pool did not report a result)" fallback, losing the real reason
// the page failed. Fixed by wrapping the render call in its own try/catch
// that persists the actual failure before rethrowing (same pattern already
// used for the fetch-failure and extraction-failure cases in this file).
test('a renderWithBrowser() that throws preserves the real error in the crawl report, not a generic fallback', async () => {
    const server = await startLocalServer(path.join(__dirname, '..', 'benchmark', 'fixtures'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-render-error-'));

    try {
        const result = await crawlSite(server.url('spa-product.html'), { name: 'string' }, {
            maxPages: 1, workers: 1, delayMs: 0, checkpointDir,
            maxRetries: 0, // isolate the failure-preservation behavior from retry mechanics (covered separately below)
            // runWorkerPool sleeps errorBackoffMinMs..MaxMs after every
            // failed attempt regardless of whether it's retried or given up
            // (default 20-40s) — turned down so this test doesn't sit there.
            errorBackoffMinMs: 10, errorBackoffMaxMs: 30,
            extractOptions: {
                renderWithBrowser: async () => { throw new Error('renderer exploded'); },
            },
        });

        assert.equal(result.pagesFailed, 1, 'the page should be counted as failed');
        assert.equal(result.pagesExtracted, 0);
        assert.equal(result.pages.length, 1);

        const page = result.pages[0];
        assert.equal(page.url, server.url('spa-product.html'), 'the URL must still be preserved');
        assert.equal(page.error, 'render failed: renderer exploded', `expected the real render error, got: ${JSON.stringify(page.error)}`);
        assert.notEqual(page.error, 'not processed (worker pool did not report a result)', 'must not fall back to the generic unprocessed message');
        assert.ok(page.warnings.includes('render failed: renderer exploded'), 'warnings should also record the failure');
    } finally {
        await server.close();
    }
});

// Same failure, but proves retries still work normally around it: the
// renderer fails on its first attempt and succeeds on the second (a real,
// plausible transient-failure shape), and runWorkerPool's retry — driven by
// maxRetries here, not a code path this fix touches — recovers correctly,
// ending with a real successful result rather than the persisted failure
// from the first attempt.
test('a renderWithBrowser() that fails once and succeeds on retry still produces a real successful result', async () => {
    const RENDERED_HTML = `<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Recovered After Retry"}</script>
</body></html>`;
    const server = await startLocalServer(path.join(__dirname, '..', 'benchmark', 'fixtures'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-render-retry-'));

    try {
        let attempts = 0;
        const renderWithBrowser = async () => {
            attempts++;
            if (attempts === 1) throw new Error('transient renderer crash');
            return RENDERED_HTML;
        };

        const result = await crawlSite(server.url('spa-product.html'), { name: 'string' }, {
            maxPages: 1, workers: 1, delayMs: 0, checkpointDir,
            maxRetries: 1,
            // Turned down from runWorkerPool's real-world 20-40s default —
            // this test only needs the retry to happen, not to happen slowly.
            errorBackoffMinMs: 10, errorBackoffMaxMs: 30,
            extractOptions: { renderWithBrowser },
        });

        assert.equal(attempts, 2, 'renderWithBrowser should have been called twice (fail, then retry succeeds)');
        assert.equal(result.pagesExtracted, 1, 'the retried job should ultimately succeed');
        assert.equal(result.pagesFailed, 0);
        assert.equal(result.pages[0].error, null, 'the final result must be the successful retry, not the earlier failure');
        assert.equal(result.pages[0].data[0].name, 'Recovered After Retry');
    } finally {
        await server.close();
    }
});

// When a checkpointDir IS deliberately reused, previously-completed pages
// must report their real persisted data, not "not processed."
test('reusing checkpointDir on purpose correctly reports previously-completed pages with real data, not as unprocessed', async () => {
    const server = await startLocalServer(path.join(__dirname, 'fixtures', 'mini-site'));
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chiselforge-crawl-reuse-'));

    try {
        const first = await crawlSite(server.url('index.html'), { title: 'string' }, {
            maxPages: 10, workers: 2, delayMs: 0, checkpointDir,
        });
        assert.equal(first.pagesExtracted, 3);

        const second = await crawlSite(server.url('index.html'), { title: 'string' }, {
            maxPages: 10, workers: 2, delayMs: 0, checkpointDir,
        });

        assert.equal(second.pagesExtracted, 3, 'previously-completed pages must still be reported as extracted, with real data');
        for (const page of second.pages) {
            assert.equal(page.error, null);
            assert.equal(page.strategy, 'json-ld');
            assert.ok(page.data.length > 0, `page ${page.url} should have its real persisted data, not be empty`);
        }
    } finally {
        await server.close();
    }
});
