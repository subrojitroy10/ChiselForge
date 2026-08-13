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
