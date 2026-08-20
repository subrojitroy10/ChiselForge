// Regression test for a real bug: autoExtract() found a JSON-LD block that
// was RELEVANT to the schema (its own field names plausibly matched) and
// returned it immediately, without checking whether it actually satisfied
// the schema. A Product block carrying only name/price, against a schema
// asking for name/price/rating, was returned as the final (invalid) result
// instead of falling through to the LLM-backed tiers that could actually
// answer the full request — silently answering a narrower question than the
// one asked, which contradicts "escalate only when the cheaper tier can't
// actually answer the request." Fixed in extraction/auto.js: tier 1 only
// short-circuits when at least one JSON-LD item genuinely validates.
//
// Uses a local stub HTTP server standing in for the LLM endpoint (same
// pattern as test/llm-provider-swap.test.js) and options.html to avoid a
// real page fetch — offline, deterministic, no real API call, no cost.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { autoExtract } = require('../extraction/auto');

function startStubLLMServer(responseContent) {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: responseContent } }] }));
        });
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) });
        });
    });
}

const PAGE_WITH_INCOMPLETE_JSON_LD = `<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Wireless Keyboard","price":"59.99"}</script>
<p>Wireless Keyboard, $59.99, rated 4.5 out of 5 stars by reviewers.</p>
</body></html>`;

test('JSON-LD relevant to the schema but missing a required field escalates to the LLM tier, not returned invalid', async () => {
    const stub = await startStubLLMServer('[{"name":"Wireless Keyboard","price":"59.99","rating":4.5}]');
    try {
        const result = await autoExtract('http://local.invalid/', { name: 'string', price: 'string', rating: 'number' }, {
            html: PAGE_WITH_INCOMPLETE_JSON_LD,
            baseUrl: stub.baseUrl,
            apiKey: 'fake-key-not-a-real-secret',
        });

        assert.equal(result.extraction.strategy, 'text', 'should have escalated past the incomplete json-ld tier');
        assert.equal(result.extraction.llmUsed, true);
        assert.equal(result.extraction.validation.valid, true);
        assert.equal(result.data[0].rating, 4.5, 'the field json-ld alone could not supply should come from the escalated tier');
    } finally {
        await stub.close();
    }
});

test('JSON-LD that fully satisfies the schema still short-circuits (no LLM call)', async () => {
    const stub = await startStubLLMServer('[]'); // would fail the assertions below if it were ever actually called
    try {
        const result = await autoExtract('http://local.invalid/', { name: 'string', price: 'string' }, {
            html: PAGE_WITH_INCOMPLETE_JSON_LD,
            baseUrl: stub.baseUrl,
            apiKey: 'fake-key-not-a-real-secret',
        });

        assert.equal(result.extraction.strategy, 'json-ld');
        assert.equal(result.extraction.llmUsed, false);
        assert.equal(result.data[0].name, 'Wireless Keyboard');
    } finally {
        await stub.close();
    }
});
