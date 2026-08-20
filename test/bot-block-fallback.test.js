// Regression test for a real gap found live against lovable.dev: a plain
// fetch() blocked by bot-detection (HTTP 403) hard-throws inside
// transports/http.js's fetchHtml, so extraction/auto.js never gets a chance
// to consider the browser-render fallback — a bot-protected site never even
// attempts a browser render, even though a real browser (real TLS/JS
// fingerprint, cookies) can sometimes get past a check that blocks a bare
// fetch() outright.
//
// This is deliberately an OPT-IN mode (options.renderOnBlock /
// --render-on-block), not a change to default behavior — attempting to get
// past bot-detection is a real behavioral choice, unlike rendering JS for a
// page that plainly needs it, so the plain-fetch default (any non-2xx
// throws immediately) stays exactly as it was unless a caller deliberately
// asks for the bypass attempt.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { fetchHtml, BOT_BLOCK_STATUSES } = require('../transports/http');
const { classifyHtml } = require('../extraction/classify');
const { autoExtract } = require('../extraction/auto');

// A page body that would NOT be flagged by the pre-existing empty-shell
// heuristic (plenty of source text, no bare #root/#app mount point) —
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

test('fetchHtml still throws on a bot-block status (403) by default — unchanged behavior', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        await assert.rejects(() => fetchHtml(server.url), /HTTP 403/);
    } finally {
        await server.close();
    }
});

test('fetchHtml returns the status + body for a bot-block status when allowBotBlockFallback is true', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        const result = await fetchHtml(server.url, { allowBotBlockFallback: true });
        assert.equal(result.status, 403);
        assert.ok(result.html.includes('403 Forbidden'));
    } finally {
        await server.close();
    }
});

test('fetchHtml still throws on a non-bot-block error status (404) even with allowBotBlockFallback: true', async () => {
    const server = await startStatusServer(404, '<html><body>Not found</body></html>');
    try {
        await assert.rejects(() => fetchHtml(server.url, { allowBotBlockFallback: true }), /HTTP 404/);
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

test('classifyHtml flags needsBrowser for a bot-block status even when the body has plenty of source text', () => {
    const withoutStatus = classifyHtml(BLOCKED_PAGE_BODY);
    assert.equal(withoutStatus.needsBrowser, false, 'sanity check: this body alone should NOT trip the empty-shell heuristic');

    const withStatus = classifyHtml(BLOCKED_PAGE_BODY, { status: 403 });
    assert.equal(withStatus.needsBrowser, true);
    assert.equal(withStatus.blockedStatus, 403);
});

test('autoExtract still throws on a blocked page by default (renderOnBlock not set)', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return REAL_CONTENT_HTML; };

        await assert.rejects(() => autoExtract(server.url, { name: 'string' }, { renderWithBrowser }), /HTTP 403/);
        assert.equal(called, false, 'renderOnBlock defaults to off — renderWithBrowser must not be invoked for a 403');
    } finally {
        await server.close();
    }
});

test('autoExtract falls back to renderWithBrowser on a 403 when renderOnBlock: true is explicitly set', async () => {
    const server = await startStatusServer(403, BLOCKED_PAGE_BODY);
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return REAL_CONTENT_HTML; };

        const result = await autoExtract(server.url, { name: 'string' }, { renderWithBrowser, renderOnBlock: true });

        assert.equal(called, true, 'renderWithBrowser should have been invoked when renderOnBlock is explicitly true');
        assert.equal(result.extraction.browserUsed, true);
        assert.equal(result.extraction.strategy, 'json-ld');
        assert.equal(result.data[0].name, 'Real Product');
    } finally {
        await server.close();
    }
});

test('autoExtract still fails on a genuine 404 even with renderOnBlock: true', async () => {
    const server = await startStatusServer(404, '<html><body>Not found</body></html>');
    try {
        let called = false;
        const renderWithBrowser = async () => { called = true; return REAL_CONTENT_HTML; };

        await assert.rejects(
            () => autoExtract(server.url, { name: 'string' }, { renderWithBrowser, renderOnBlock: true }),
            /HTTP 404/
        );
        assert.equal(called, false, 'a 404 is not a bot-block signal regardless of renderOnBlock; renderWithBrowser must not be called');
    } finally {
        await server.close();
    }
});
