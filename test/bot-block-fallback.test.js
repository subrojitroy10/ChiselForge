// Regression test for a real gap found live against lovable.dev: a plain
// fetch() blocked by bot-detection (HTTP 403) used to hard-throw inside
// transports/http.js's fetchHtml, before extraction/auto.js ever got a
// chance to consider the browser-render fallback — so a bot-protected site
// never even attempted a browser render, even though a real browser (real
// TLS/JS fingerprint, cookies) can sometimes get past a check that blocks a
// bare fetch() outright. Fixed by treating 403/429/503 as their own
// needsBrowser signal (see transports/http.js's BOT_BLOCK_STATUSES and
// extraction/classify.js), independent of the existing empty-shell
// heuristic. Other non-2xx statuses (404, 401, 500, ...) are not bot-block
// signals and must still throw — a browser can't fix "page doesn't exist."

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { fetchHtml, BOT_BLOCK_STATUSES } = require('../transports/http');
const { classifyHtml } = require('../extraction/classify');
const { autoExtract } = require('../extraction/auto');

// A page body that would NOT be flagged by the pre-existing empty-shell
// heuristic (plenty of visible text, no bare #root/#app mount point) —
// proves the bot-block signal is genuinely independent of body shape, not a
// side effect of the blocked page happening to look empty.
const BLOCKED_PAGE_BODY = `<html><body>
<h1>403 Forbidden</h1>
<p>Access to this resource has been denied by our security service. If you
believe this is an error, please contact support with reference ID
${'x'.repeat(220)}.</p>
</body></html>`;

const REAL_CONTENT_HTML = `<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Real Product"}</script>
<div id="root"><h1>Real Product</h1></div>
</body></html>`;

function startStatusServer(status, body) {
    const server = http.createServer((req, res) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(body);
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

test('fetchHtml does not throw on a bot-block status (403) and returns the status + body', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        const result = await fetchHtml(server.url);
        assert.equal(result.status, 403);
        assert.ok(result.html.includes('403 Forbidden'));
    } finally {
        await server.close();
    }
});

test('fetchHtml still throws on a non-bot-block error status (404)', async () => {
    const server = await startStatusServer(404, '<html><body>Not found</body></html>');
    try {
        await assert.rejects(() => fetchHtml(server.url), /HTTP 404/);
    } finally {
        await server.close();
    }
});

test('BOT_BLOCK_STATUSES covers 403, 429, and 503 specifically', () => {
    assert.ok(BOT_BLOCK_STATUSES.has(403));
    assert.ok(BOT_BLOCK_STATUSES.has(429));
    assert.ok(BOT_BLOCK_STATUSES.has(503));
    assert.ok(!BOT_BLOCK_STATUSES.has(404));
    assert.ok(!BOT_BLOCK_STATUSES.has(500));
});

test('classifyHtml flags needsBrowser for a bot-block status even when the body has plenty of visible text', () => {
    const withoutStatus = classifyHtml(BLOCKED_PAGE_BODY);
    assert.equal(withoutStatus.needsBrowser, false, 'sanity check: this body alone should NOT trip the empty-shell heuristic');

    const withStatus = classifyHtml(BLOCKED_PAGE_BODY, { status: 403 });
    assert.equal(withStatus.needsBrowser, true);
    assert.equal(withStatus.blockedStatus, 403);
});

test('classifyHtml does not flag needsBrowser for a normal 200 response', () => {
    const result = classifyHtml(REAL_CONTENT_HTML, { status: 200 });
    assert.equal(result.blockedStatus, null);
});

test('autoExtract falls back to renderWithBrowser when the initial fetch is bot-blocked (403)', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return REAL_CONTENT_HTML; };

        const result = await autoExtract(server.url, { name: 'string' }, { renderWithBrowser });

        assert.equal(called, true, 'renderWithBrowser should have been invoked for a 403 response');
        assert.equal(result.extraction.browserUsed, true);
        assert.equal(result.extraction.strategy, 'json-ld');
        assert.equal(result.data[0].name, 'Real Product');
    } finally {
        await server.close();
    }
});

test('autoExtract still throws the clear browser-required error on a 403 when no renderWithBrowser is supplied', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        await assert.rejects(
            () => autoExtract(server.url, { name: 'string' }, {}),
            /appears to require a browser/
        );
    } finally {
        await server.close();
    }
});

test('autoExtract still fails on a genuine 404 rather than attempting a browser render', async () => {
    const server = await startStatusServer(404, '<html><body>Not found</body></html>');
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return REAL_CONTENT_HTML; };

        await assert.rejects(() => autoExtract(server.url, { name: 'string' }, { renderWithBrowser }), /HTTP 404/);
        assert.equal(called, false, 'a 404 is not a bot-block signal; renderWithBrowser must not be called');
    } finally {
        await server.close();
    }
});
