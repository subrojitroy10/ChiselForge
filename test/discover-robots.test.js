// robots.txt was previously read ONLY for its Sitemap: entries — Disallow/
// Allow rules were parsed by nothing, so discoverPages() (and therefore
// crawl/crawlSite.js) could happily discover and later fetch paths a site's
// own robots.txt explicitly disallowed. Real gap for a general-purpose OSS
// crawler. Fixed with a minimal robots.txt parser, on (respectRobots: true)
// by default — the seed URL itself is always exempt (the operator
// explicitly asked for that exact page).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { discoverPages } = require('../crawl/discover');

const ROBOTS_TXT = `
User-agent: *
Disallow: /private/
Allow: /private/public-page.html
`;

const PAGES = {
    '/': '<html><body><a href="/about">About</a><a href="/private/secret.html">Secret</a><a href="/private/public-page.html">Allowed under a disallowed prefix</a></body></html>',
    '/about': '<html><body>About page, no further links.</body></html>',
    '/private/secret.html': '<html><body>Should never be fetched.</body></html>',
    '/private/public-page.html': '<html><body>Explicitly allowed despite the /private/ prefix.</body></html>',
};

function startServer({ withRobots = true } = {}) {
    let secretWasFetched = false;
    const server = http.createServer((req, res) => {
        if (req.url === '/robots.txt') {
            if (!withRobots) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(ROBOTS_TXT);
            return;
        }
        if (req.url === '/private/secret.html') secretWasFetched = true;
        const body = PAGES[req.url];
        if (!body) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({
                url: `http://127.0.0.1:${port}/`,
                wasSecretFetched: () => secretWasFetched,
                close: () => new Promise(r => server.close(r)),
            });
        });
    });
}

test('discoverPages excludes robots.txt-disallowed paths by default, and never fetches them', async () => {
    const server = await startServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 10, timeoutMs: 5000, delayMs: 0 });

        assert.ok(result.pages.some(p => p.endsWith('/about')), 'allowed page should be discovered');
        assert.ok(!result.pages.some(p => p.endsWith('/private/secret.html')), 'disallowed page should not be in the result');
        assert.ok(result.pages.some(p => p.endsWith('/private/public-page.html')), 'an explicit Allow under a disallowed prefix should still be discovered (longest-match-wins)');
        assert.ok(result.robotsDisallowedCount >= 1, 'robotsDisallowedCount should reflect the skipped page');

        // The real point: robots.txt governs FETCHING, not just the final
        // list — a disallowed link must never even be requested.
        assert.equal(server.wasSecretFetched(), false, '/private/secret.html must never have been fetched at all');
    } finally {
        await server.close();
    }
});

test('respectRobots: false discovers everything, including disallowed paths', async () => {
    const server = await startServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 10, timeoutMs: 5000, delayMs: 0, respectRobots: false });

        assert.ok(result.pages.some(p => p.endsWith('/private/secret.html')), 'with respectRobots:false, the disallowed page should be discovered');
        assert.equal(result.robotsDisallowedCount, 0);
    } finally {
        await server.close();
    }
});

test('no robots.txt present means everything is allowed', async () => {
    const server = await startServer({ withRobots: false });
    try {
        const result = await discoverPages(server.url, { maxPages: 10, timeoutMs: 5000, delayMs: 0 });
        assert.ok(result.pages.some(p => p.endsWith('/private/secret.html')), 'no robots.txt at all should not restrict discovery');
        assert.equal(result.robotsDisallowedCount, 0);
    } finally {
        await server.close();
    }
});
