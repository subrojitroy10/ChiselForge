// Some pages return almost no content until client-side JS runs (an "empty
// SPA shell" — see extraction/classify.js's looksLikeEmptyShell). autoExtract
// never launches a browser itself; you supply a renderWithBrowser(url)
// callback (see docs/architecture.md's "Why no built-in browser fallback").
// transports/browser.js's createBrowserRenderer builds that callback for you
// from a real Playwright instance.
//
// This serves a local empty-shell fixture (no external site — matches
// docs/benchmarks.md's reasoning for using a local fixture for this case)
// whose client-side JS injects real content, including JSON-LD, once
// "rendered" — so this runs with no LLM key needed, only playwright.
//
//   npm install playwright && npx playwright install chromium
//   node examples/browser-fallback.js

const http = require('http');
const { autoExtract, browser } = require('../index');

const EMPTY_SHELL_HTML = `<!DOCTYPE html>
<html><body>
<div id="root"></div>
<script>
document.getElementById('root').outerHTML =
    '<script type="application/ld+json">' +
    JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Widget X', price: '19.99' }) +
    '<\\/script><h1>Widget X</h1>';
</script>
</body></html>`;

function startFixtureServer() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(EMPTY_SHELL_HTML);
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) });
        });
    });
}

async function main() {
    const fixture = await startFixtureServer();
    // createBrowserRenderer() itself never touches playwright — it only
    // requires it lazily on the first actual render, inside autoExtract()
    // below, so the missing-dependency error (if any) surfaces from there.
    const renderer = browser.createBrowserRenderer();

    try {
        const result = await autoExtract(fixture.url, { name: 'string', price: 'string' }, {
            renderWithBrowser: renderer.renderWithBrowser,
        });
        console.log('data:', result.data);
        console.log('strategy:', result.extraction.strategy, '| browserUsed:', result.extraction.browserUsed);
    } catch (err) {
        console.log('Skipping: ' + err.message);
    } finally {
        await renderer.close();
        await fixture.close();
    }
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
