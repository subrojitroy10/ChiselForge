// End-to-end crawlSite() test against a local 3-page fixture site — proves
// discovery (link crawl) + extraction (JSON-LD tier, no LLM needed since
// every fixture page carries relevant JSON-LD) + report generation all work
// together, fully offline and deterministic. Live-site crawling and the LLM
// tiers are exercised separately in benchmark/ (real network, real cost —
// see BENCHMARKS.md), kept out of the committed test suite intentionally.

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
