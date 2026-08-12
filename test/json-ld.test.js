const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJsonLdBlocks, findByType } = require('../extraction/json-ld');

const html = `
<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Review","author":"Jane","reviewBody":"Nice"}</script>
</body></html>`;

test('extracts all JSON-LD blocks', () => {
    const blocks = extractJsonLdBlocks(html);
    assert.equal(blocks.length, 2);
});

test('findByType filters to the relevant block only', () => {
    const blocks = extractJsonLdBlocks(html);
    const reviews = findByType(blocks, 'Review');
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].author, 'Jane');
});

test('findByType returns empty when no block matches', () => {
    const blocks = extractJsonLdBlocks(html);
    assert.equal(findByType(blocks, 'Product').length, 0);
});

test('malformed JSON-LD is skipped, not thrown', () => {
    const badHtml = '<script type="application/ld+json">{not valid json}</script>';
    assert.doesNotThrow(() => extractJsonLdBlocks(badHtml));
    assert.equal(extractJsonLdBlocks(badHtml).length, 0);
});
