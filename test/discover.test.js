const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, sameSitePage } = require('../crawl/discover');

test('normalize resolves relative URLs against a base and strips tracking params', () => {
    assert.equal(normalize('/about', 'https://example.com/'), 'https://example.com/about');
    assert.equal(normalize('https://example.com/page?utm_source=x&id=5', 'https://example.com/'), 'https://example.com/page?id=5');
});

test('normalize rejects non-http(s) schemes', () => {
    assert.equal(normalize('mailto:test@example.com', 'https://example.com/'), null);
    assert.equal(normalize('javascript:void(0)', 'https://example.com/'), null);
});

test('sameSitePage rejects a different host', () => {
    const result = sameSitePage('https://other.com/page', 'https://example.com/', 'example.com');
    assert.equal(result, null);
});

test('sameSitePage rejects non-page asset extensions', () => {
    assert.equal(sameSitePage('/logo.png', 'https://example.com/', 'example.com'), null);
    assert.equal(sameSitePage('/style.css', 'https://example.com/', 'example.com'), null);
    assert.equal(sameSitePage('/data.json', 'https://example.com/', 'example.com'), null);
});

test('sameSitePage accepts a same-host HTML-ish page', () => {
    assert.equal(sameSitePage('/about', 'https://example.com/', 'example.com'), 'https://example.com/about');
});
