const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJsonLdBlocks, findByType, findRelevantBlocks } = require('../extraction/json-ld');

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

// This is deliberately a completely different domain (a product/e-commerce
// shape) from the review-site fixtures elsewhere in this suite — the point is
// to prove the relevance heuristic is generic field-overlap logic, not
// something secretly tuned to Zomato's field names.
const ecommerceBlocks = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ShopExample', url: 'https://shop.example' },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [] },
    { '@context': 'https://schema.org', '@type': 'Product', name: 'Wireless Mouse', price: '19.99', ratingValue: 4.2 },
];

test('findRelevantBlocks picks the block whose fields match the schema, ignoring irrelevant-but-present blocks', () => {
    const schema = { name: 'string', price: 'number' };
    const relevant = findRelevantBlocks(ecommerceBlocks, schema);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0]['@type'], 'Product');
});

test('findRelevantBlocks returns nothing when no block\'s fields plausibly match', () => {
    const schema = { author: 'string', reviewText: 'string', stars: 'number' };
    const relevant = findRelevantBlocks(ecommerceBlocks, schema);
    assert.equal(relevant.length, 0);
});

test('findRelevantBlocks does not false-positive on a WebSite block just because "name" is a common field', () => {
    // WebSite also has a "name" field — a naive single-field-match heuristic
    // would wrongly accept it for any schema containing "name". Requiring a
    // meaningful overlap ratio (not just >=1 match) avoids this.
    const schema = { name: 'string', price: 'number', ratingValue: 'number' };
    const relevant = findRelevantBlocks(ecommerceBlocks, schema);
    assert.equal(relevant.length, 1);
    assert.equal(relevant[0]['@type'], 'Product');
});
