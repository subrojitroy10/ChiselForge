// Regression test for a real gap found live crawling lovable.dev: the
// link-crawl BFS in crawl/discover.js used its own fetcher (fetchText) that
// threw on ANY non-2xx status, so a bot-blocked seed page failed discovery
// via link-crawl entirely — only crawlSite.js's own per-page fetch (fixed
// earlier, see test/bot-block-fallback.test.js) had the browser-render
// fallback. In practice this degraded gracefully on lovable.dev because
// sitemap-based discovery covered everything, but a site with no sitemap
// would have lost discovery completely. Fixed the same way, same opt-in
// pattern: options.renderOnBlock (off by default), requires renderWithBrowser.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { discoverPages } = require('../crawl/discover');

function startDiscoveryServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            // Seed page is bot-blocked — no sitemap/robots.txt exist either,
            // so link-crawl is the ONLY discovery path in this test.
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>403 Forbidden</h1></body></html>');
            return;
        }
        if (req.url === '/other') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Other page</h1></body></html>');
            return;
        }
        res.writeHead(404);
        res.end('not found');
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({
                url: `http://127.0.0.1:${port}/`,
                close: () => new Promise(r => server.close(r)),
            });
        });
    });
}

// HTML a "browser render" of the blocked seed page would have returned —
// contains a real link so link-crawl discovery can find /other.
const RENDERED_SEED_HTML = `<html><body>
<h1>Real content</h1>
<a href="/other">Other</a>
</body></html>`;

test('discoverPages records a failure for the seed when bot-blocked and renderOnBlock is not set (default)', async () => {
    const server = await startDiscoveryServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 10, timeoutMs: 5000, delayMs: 0 });

        assert.equal(result.crawledPageCount, 1, 'only the seed itself (added upfront) — no links discovered since the fetch failed');
        assert.equal(result.failures.length, 1);
        assert.match(result.failures[0].error, /HTTP 403/);
    } finally {
        await server.close();
    }
});

test('discoverPages falls back to renderWithBrowser for the link-crawl when renderOnBlock: true is set', async () => {
    const server = await startDiscoveryServer();
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return RENDERED_SEED_HTML; };

        const result = await discoverPages(server.url, {
            maxPages: 10, timeoutMs: 5000, delayMs: 0,
            renderWithBrowser, renderOnBlock: true,
        });

        assert.equal(called, true, 'renderWithBrowser should have been invoked for the blocked seed page');
        assert.equal(result.failures.length, 0, 'no discovery failure once the render fallback succeeded');
        assert.ok(result.pages.some(p => p.endsWith('/other')), `expected /other to be discovered via the rendered page's link, got: ${result.pages.join(', ')}`);
    } finally {
        await server.close();
    }
});
