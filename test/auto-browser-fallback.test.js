// Tests the needsBrowser -> renderWithBrowser control flow in
// extraction/auto.js. Uses a real local HTTP server (see benchmark/local-server.js)
// serving the same SPA-shell fixture the benchmark uses, but stubs
// renderWithBrowser instead of launching real Playwright — keeps this test
// suite fast, deterministic, and free of the playwright dependency. Real
// Playwright rendering IS exercised for real in benchmark/run.js (see
// docs/benchmarks.md) — this test is about the control flow, not proving
// Playwright itself works.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { autoExtract } = require('../extraction/auto');
const { startLocalServer } = require('../benchmark/local-server');

const RENDERED_HTML = `
<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Wireless Keyboard Pro","price":"59.99"}</script>
<div id="root"><h1>Wireless Keyboard Pro</h1></div>
</body></html>`;

test('throws a clear error when the page needs a browser and none was supplied', async () => {
    const server = await startLocalServer(path.join(__dirname, '..', 'benchmark', 'fixtures'));
    try {
        await assert.rejects(
            () => autoExtract(server.url('spa-product.html'), { name: 'string' }, {}),
            /appears to require a browser/
        );
    } finally {
        await server.close();
    }
});

test('calls renderWithBrowser when supplied and reports browserUsed:true', async () => {
    const server = await startLocalServer(path.join(__dirname, '..', 'benchmark', 'fixtures'));
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return RENDERED_HTML; };

        const result = await autoExtract(
            server.url('spa-product.html'),
            { name: 'string', price: 'string' },
            { renderWithBrowser }
        );

        assert.equal(called, true);
        assert.equal(result.extraction.browserUsed, true);
        assert.equal(result.extraction.strategy, 'json-ld');
        assert.equal(result.data[0].name, 'Wireless Keyboard Pro');
    } finally {
        await server.close();
    }
});

test('browserUsed is false when the page never needed a browser', async () => {
    const server = await startLocalServer(path.join(__dirname, 'fixtures'));
    try {
        const result = await autoExtract(
            server.url('json-ld.html'),
            { author: 'string' },
            {}
        );
        assert.equal(result.extraction.browserUsed, false);
    } finally {
        await server.close();
    }
});
