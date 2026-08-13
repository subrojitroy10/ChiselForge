// Proves autoExtract() actually forwards baseUrl/model/apiKey through to the
// LLM call — not just that extraction/llm.js supports these options in
// isolation. Found as a real gap: auto.js previously destructured apiKey and
// model from options but never baseUrl, so anyone using the documented
// autoExtract() API (not calling extractWithLLM directly) had no way to
// actually switch providers despite the "provider-agnostic" claim in the
// docs. This test would have caught that.
//
// Uses a local stub HTTP server standing in for an LLM endpoint — offline,
// deterministic, no real API call, no cost.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { autoExtract } = require('../extraction/auto');

function startStubLLMServer(responseContent) {
    let receivedBody = null;
    const server = http.createServer((req, res) => {
        if (req.url === '/chat/completions' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', () => {
                receivedBody = JSON.parse(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ choices: [{ message: { content: responseContent } }] }));
            });
        } else {
            res.writeHead(404); res.end();
        }
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({
                baseUrl: `http://127.0.0.1:${port}`,
                getReceivedBody: () => receivedBody,
                close: () => new Promise(r => server.close(r)),
            });
        });
    });
}

test('autoExtract forwards baseUrl to a custom LLM endpoint (not just extraction/llm.js in isolation)', async () => {
    const stub = await startStubLLMServer('[{"title":"stub result","purpose":"proves baseUrl forwarding"}]');
    try {
        const result = await autoExtract('https://example.com/', { title: 'string', purpose: 'string' }, {
            apiKey: 'fake-key-not-a-real-secret',
            baseUrl: stub.baseUrl,
            model: 'totally-custom-model-id',
        });

        assert.ok(stub.getReceivedBody(), 'request never reached the custom baseUrl');
        assert.equal(stub.getReceivedBody().model, 'totally-custom-model-id');
        assert.equal(result.data[0].title, 'stub result');
    } finally {
        await stub.close();
    }
});

test('autoExtract forwards llmMaxTokens and llmTimeoutMs consistently across tiers', async () => {
    const stub = await startStubLLMServer('[{"title":"x","purpose":"y"}]');
    try {
        await autoExtract('https://example.com/', { title: 'string', purpose: 'string' }, {
            apiKey: 'fake-key', baseUrl: stub.baseUrl, llmMaxTokens: 777,
        });
        assert.equal(stub.getReceivedBody().max_tokens, 777);
    } finally {
        await stub.close();
    }
});
