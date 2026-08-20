// A more realistic typed schema against a real product page.
// books.toscrape.com is a site built and maintained specifically for
// scraper testing/practice (same one used in docs/benchmarks.md), so this
// is safe to run repeatedly with no ToS ambiguity. It has no JSON-LD, so
// this exercises the LLM-backed text tier — needs NIM_API_KEY.
//
//   NIM_API_KEY=your-key node examples/extract-product.js

const { autoExtract } = require('../index');

async function main() {
    if (!process.env.NIM_API_KEY) {
        console.log('Set NIM_API_KEY to run this example — see docs/llm-providers.md.');
        return;
    }

    const url = 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html';
    const result = await autoExtract(url, {
        title: 'string',
        price: 'string',
        availability: 'string',
    }, {
        // jsonLdType would short-circuit tier 1 with an exact schema.org
        // @type match if this page had relevant JSON-LD (it doesn't) — see
        // extraction/auto.js's JSDoc. Left here as a comment, not a live
        // option, since setting it on a page with no matching JSON-LD would
        // just be ignored, not demonstrate anything.
    });

    console.log('data:', result.data);
    console.log('strategy:', result.extraction.strategy, '| llmUsed:', result.extraction.llmUsed);
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
