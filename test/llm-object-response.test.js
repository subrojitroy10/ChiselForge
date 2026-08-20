// Regression test for a real crash: a provider returning a single bare JSON
// object (e.g. {"title":"single object"}) instead of an array — a real
// response shape for a single-entity page, despite the system prompt asking
// for an array — used to propagate as-is out of extractWithLLM(). Every
// downstream consumer assumes an array (extractWithRetryOnEmpty checks
// Array.isArray/.length; validateItems calls (items || []).map(...)), so a
// bare object crashed with "items.map is not a function" instead of being
// handled. Fixed in extraction/llm.js: normalize once, at the boundary.
//
// Local stub HTTP server standing in for the LLM endpoint — offline,
// deterministic, no real API call, no cost.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { extractWithLLM } = require('../extraction/llm');
const { validateItems } = require('../extraction/validate');

function startStubLLMServer(responseContent) {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: responseContent } }] }));
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) });
        });
    });
}

test('extractWithLLM normalizes a single bare object response into a one-item array', async () => {
    const stub = await startStubLLMServer('{"title":"single object"}');
    try {
        const result = await extractWithLLM('page text', { title: 'string' }, {
            apiKey: 'fake-key', baseUrl: stub.baseUrl, isHtml: false,
        });

        assert.ok(Array.isArray(result), 'result must be an array, not the bare object the provider returned');
        assert.equal(result.length, 1);
        assert.equal(result[0].title, 'single object');

        // The actual downstream crash this bug caused — validateItems must
        // not throw on the result extractWithLLM hands it.
        assert.doesNotThrow(() => validateItems(result, { title: 'string' }));
    } finally {
        await stub.close();
    }
});
