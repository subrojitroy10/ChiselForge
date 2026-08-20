// Demonstrates pointing ChiselForge at any OpenAI-compatible endpoint —
// a local Ollama server, OpenAI itself, or (as here) a throwaway stub — via
// options.baseUrl/model/apiKey, forwarded all the way through autoExtract().
// This is the actual provider-swap mechanism the README's "provider-agnostic"
// claim rests on; see test/llm-provider-swap.test.js, which this mirrors.
//
// Fully self-contained and offline: runs a local HTTP server standing in for
// the LLM endpoint, and passes options.html so autoExtract never fetches a
// real page either. No API key, no network, no cost.
//
//   node examples/custom-llm-provider.js

const http = require('http');
const { autoExtract } = require('../index');

function startStubLLMServer() {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            const parsed = JSON.parse(body);
            console.log(`stub endpoint received a request for model "${parsed.model}"`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { content: '[{"title":"stub result","purpose":"proves baseUrl forwarding"}]' } }],
            }));
        });
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) });
        });
    });
}

async function main() {
    const stub = await startStubLLMServer();
    try {
        const result = await autoExtract('http://local.invalid/', { title: 'string', purpose: 'string' }, {
            html: '<html><body><p>no structured data here</p></body></html>',
            baseUrl: stub.baseUrl,          // swap this for a real OpenAI-compatible host
            model: 'any-model-id-your-endpoint-serves',
            apiKey: 'not-checked-by-this-stub',
        });
        console.log('data:', result.data);
    } finally {
        await stub.close();
    }
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
