// Regression test for a real undercount: robots.txt filtering itself worked
// (both discoverFromSitemaps and crawlLinks already called isAllowed()
// before adding a page), but only crawlLinks incremented a counter for its
// own rejections. A URL disallowed by robots.txt that was ONLY ever listed
// in the sitemap (never reachable via the link-crawl BFS, e.g. an orphan
// page with no incoming links) was correctly excluded from `pages`, but
// invisible to `robotsDisallowedCount` — the telemetry silently underreported
// real exclusions. Fixed by recording rejections into one Set shared by both
// discovery sources (see discoverPages in crawl/discover.js), which both
// counts across both sources AND naturally avoids double-counting a URL
// disallowed and present in both.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { discoverPages } = require('../crawl/discover');

const ROBOTS_TXT = `
User-agent: *
Disallow: /private/
`;

function sitemapXml(paths) {
    const urls = paths.map(p => `<url><loc>PLACEHOLDER${p}</loc></url>`).join('');
    return `<?xml version="1.0"?><urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

const PAGES = {
    '/': '<html><body><a href="/public">Public</a><a href="/private/link-only">Link-only disallowed</a><a href="/private/both">Both disallowed</a></body></html>',
    '/public': '<html><body>No further links.</body></html>',
    '/private/link-only': '<html><body>Disallowed, discoverable only via the link crawl.</body></html>',
    '/private/both': '<html><body>Disallowed, discoverable via BOTH the sitemap and the link crawl.</body></html>',
    '/private/sitemap-only': '<html><body>Disallowed, discoverable only via the sitemap (no incoming link anywhere).</body></html>',
};

function startServer() {
    let baseUrl;
    const server = http.createServer((req, res) => {
        if (req.url === '/robots.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(ROBOTS_TXT);
            return;
        }
        if (req.url === '/sitemap.xml') {
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            res.end(sitemapXml(['/public', '/private/both', '/private/sitemap-only']).replace(/PLACEHOLDER/g, baseUrl));
            return;
        }
        const body = PAGES[req.url];
        if (!body) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve({ url: `${baseUrl}/`, close: () => new Promise(r => server.close(r)) });
        });
    });
}

test('robotsDisallowedCount counts a sitemap-only disallowed URL (no incoming link at all)', async () => {
    const server = await startServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 20, timeoutMs: 5000, delayMs: 0 });
        assert.ok(!result.pages.some(p => p.endsWith('/private/sitemap-only')), 'the sitemap-only disallowed page must not be in the result');
        assert.ok(result.robotsDisallowedCount >= 1, 'a sitemap-only exclusion must be counted, not silently dropped');
    } finally {
        await server.close();
    }
});

test('robotsDisallowedCount counts a link-crawl-only disallowed URL (not present in the sitemap)', async () => {
    const server = await startServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 20, timeoutMs: 5000, delayMs: 0 });
        assert.ok(!result.pages.some(p => p.endsWith('/private/link-only')), 'the link-only disallowed page must not be in the result');
        assert.ok(result.robotsDisallowedCount >= 1);
    } finally {
        await server.close();
    }
});

test('a URL disallowed and present in both the sitemap and the link crawl is counted exactly once', async () => {
    const server = await startServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 20, timeoutMs: 5000, delayMs: 0 });

        assert.ok(!result.pages.some(p => p.endsWith('/private/both')), 'must be excluded');
        // Exactly the three distinct disallowed URLs this fixture defines
        // (sitemap-only, link-only, both) — proves both undercounting and
        // double-counting are fixed at once: if /private/both were counted
        // twice (once per source) this would be 4, not 3; if sitemap-only
        // exclusions were still silently dropped, this would be 2.
        assert.equal(result.robotsDisallowedCount, 3, `expected exactly 3 distinct disallowed URLs counted, got ${result.robotsDisallowedCount}`);
    } finally {
        await server.close();
    }
});

test('respectRobots: false discovers all three otherwise-disallowed URLs and reports zero disallowed', async () => {
    const server = await startServer();
    try {
        const result = await discoverPages(server.url, { maxPages: 20, timeoutMs: 5000, delayMs: 0, respectRobots: false });

        assert.ok(result.pages.some(p => p.endsWith('/private/sitemap-only')));
        assert.ok(result.pages.some(p => p.endsWith('/private/link-only')));
        assert.ok(result.pages.some(p => p.endsWith('/private/both')));
        assert.equal(result.robotsDisallowedCount, 0);
    } finally {
        await server.close();
    }
});
