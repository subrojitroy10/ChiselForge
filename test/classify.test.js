const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classifyHtml } = require('../extraction/classify');

function fixture(name) {
    return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

test('detects JSON-LD and does not flag needsBrowser', () => {
    const c = classifyHtml(fixture('json-ld.html'));
    assert.equal(c.hasJsonLd, true);
    assert.equal(c.needsBrowser, false);
});

test('detects Zomato-style escaped hydration state', () => {
    const c = classifyHtml(fixture('hydration-escaped.html'));
    assert.ok(c.hydration);
    assert.equal(c.hydration.key, '__PRELOADED_STATE__');
    assert.equal(c.hydration.state.entities.REVIEWS['1'].reviewText, 'hi');
});

test('detects Next.js __NEXT_DATA__', () => {
    const c = classifyHtml(fixture('next-data.html'));
    assert.ok(c.hydration);
    assert.equal(c.hydration.key, '__NEXT_DATA__');
    assert.equal(c.hydration.state.props.pageProps.title, 'Hello');
});

test('flags needsBrowser for an empty SPA shell', () => {
    const c = classifyHtml(fixture('spa-shell.html'));
    assert.equal(c.needsBrowser, true);
});

test('flags needsBrowser for an empty SPA shell even when JSON-LD is also present', () => {
    // Real bug, found live against stron.in (a Vite/React SPA): JSON-LD
    // presence used to short-circuit needsBrowser to false, even for a page
    // that's an empty <div id="root"></div> shell with SEO JSON-LD
    // statically injected into <head> and zero real content until JS
    // mounts. This is a common real-world pattern, not an edge case.
    const c = classifyHtml(fixture('spa-shell-with-jsonld.html'));
    assert.equal(c.hasJsonLd, true);
    assert.equal(c.needsBrowser, true);
});

test('plain SSR page with real content needs neither browser nor LLM tiers to be assumed', () => {
    const c = classifyHtml(fixture('plain-ssr.html'));
    assert.equal(c.needsBrowser, false);
    assert.equal(c.hasJsonLd, false);
    assert.equal(c.hydration, null);
    assert.ok(c.sourceTextLength > 200);
});
