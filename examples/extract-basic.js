// Simplest possible use of ChiselForge: a URL and a schema in, validated
// JSON out. example.com has no JSON-LD or hydration state, so this exercises
// the text tier (tier 3) — which means it needs an LLM key. See
// custom-llm-provider.js for an example that runs with no key at all.
//
//   NIM_API_KEY=your-key node examples/extract-basic.js

const { autoExtract } = require('../index');

async function main() {
    if (!process.env.NIM_API_KEY) {
        console.log(
            'Set NIM_API_KEY to run this example (example.com has no JSON-LD, ' +
            'so extraction falls through to the LLM-backed text tier). ' +
            'See docs/llm-providers.md for provider options.'
        );
        return;
    }

    const result = await autoExtract('https://example.com/', {
        title: 'string',
        purpose: 'string',
    });

    console.log('data:', result.data);
    console.log('extraction:', result.extraction);
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
