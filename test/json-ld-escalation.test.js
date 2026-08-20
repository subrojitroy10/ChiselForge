// Regression test for a real bug: autoExtract() found JSON-LD block(s)
// RELEVANT to the schema (field names plausibly matched, or an explicit
// @type match) and returned them immediately, without requiring the result
// to actually satisfy the schema. A Product block carrying only name/price,
// against a schema also asking for rating, was returned as the final
// (invalid) result instead of escalating to the LLM-backed tiers that could
// answer the full request — silently answering a narrower question than the
// one asked, which violates this project's own "URL + schema -> validated
// structured data" contract.
//
// The policy (extraction/auto.js): tier 1 only short-circuits when
// validateItems(relevant, schema).valid is true — i.e. EVERY relevant item
// validates, not just some. An earlier fix accepted the tier whenever
// validItems > 0 (at least one of several records valid); that was still
// wrong for the multi-record case (e.g. [{name,price}, {name}] against a
// name+price schema returned as-is instead of escalating) — this file
// covers that case explicitly, not just the single-invalid-item case.
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

// The user's exact multi-record example: [{name,price}, {name}] against a
// name+price schema — one record valid, one not. Uses @type + jsonLdType so
// findByType (which flattens a JSON-LD array into individual items) is the
// path exercised, not the field-overlap heuristic.
const PAGE_WITH_MIXED_VALIDITY_JSON_LD_ARRAY = `<html><body>
<script type="application/ld+json">[
  {"@context":"https://schema.org","@type":"Product","name":"A","price":10},
  {"@context":"https://schema.org","@type":"Product","name":"B"}
]</script>
<p>A costs 10. B's price is somewhere in the article text below.</p>
</body></html>`;

const PAGE_WITH_ALL_VALID_JSON_LD_ARRAY = `<html><body>
<script type="application/ld+json">[
  {"@context":"https://schema.org","@type":"Product","name":"A","price":10},
  {"@context":"https://schema.org","@type":"Product","name":"B","price":20}
]</script>
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

test('multiple JSON-LD records, some valid and some invalid, escalate rather than being returned partially valid', async () => {
    const stub = await startStubLLMServer('[{"name":"A","price":10},{"name":"B","price":20}]');
    try {
        const result = await autoExtract('http://local.invalid/', { name: 'string', price: 'number' }, {
            html: PAGE_WITH_MIXED_VALIDITY_JSON_LD_ARRAY,
            jsonLdType: 'Product',
            baseUrl: stub.baseUrl,
            apiKey: 'fake-key-not-a-real-secret',
        });

        assert.equal(result.extraction.strategy, 'text', 'a partially-invalid json-ld set must escalate, not be returned as-is');
        assert.equal(result.extraction.llmUsed, true);
        assert.equal(result.extraction.validation.valid, true);
        assert.equal(result.data.length, 2);
        assert.equal(result.data[1].price, 20, 'the field the invalid json-ld record lacked should come from the escalated tier');
    } finally {
        await stub.close();
    }
});

test('explicit jsonLdType follows the same validation rule: escalates on partial validity too', async () => {
    // Same fixture/schema as the field-overlap-heuristic test above, but this
    // time via an explicit jsonLdType (findByType) rather than
    // findRelevantBlocks — confirms the validity gate applies to both paths
    // into tier 1, not just the default heuristic one.
    const stub = await startStubLLMServer('[{"title":"stub","purpose":"via explicit jsonLdType"}]');
    try {
        const result = await autoExtract('http://local.invalid/', { title: 'string', purpose: 'string' }, {
            html: '<html><body><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","title":"stub"}</script></body></html>',
            jsonLdType: 'Product',
            baseUrl: stub.baseUrl,
            apiKey: 'fake-key-not-a-real-secret',
        });

        assert.equal(result.extraction.strategy, 'text');
        assert.equal(result.extraction.llmUsed, true);
    } finally {
        await stub.close();
    }
});

test('explicit jsonLdType still short-circuits (no LLM call) when every matched record fully validates', async () => {
    const stub = await startStubLLMServer('[]'); // would fail the assertions below if it were ever actually called
    try {
        const result = await autoExtract('http://local.invalid/', { name: 'string', price: 'number' }, {
            html: PAGE_WITH_ALL_VALID_JSON_LD_ARRAY,
            jsonLdType: 'Product',
            baseUrl: stub.baseUrl,
            apiKey: 'fake-key-not-a-real-secret',
        });

        assert.equal(result.extraction.strategy, 'json-ld');
        assert.equal(result.extraction.llmUsed, false);
        assert.equal(result.data.length, 2);
    } finally {
        await stub.close();
    }
});
