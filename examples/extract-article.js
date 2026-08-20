// Article/text-content extraction — a list of items from a page with no
// structured markup at all. Honest note: this project's own validated
// corpus (docs/benchmarks.md's "Known gaps") does not yet include a page
// with real Article-typed JSON-LD, so this demonstrates the same text tier
// on genuinely unstructured list content instead of a claim this doesn't
// support. quotes.toscrape.com is built for scraper practice — same
// reasoning as extract-product.js for why it's safe to hit repeatedly.
//
//   NIM_API_KEY=your-key node examples/extract-article.js

const { autoExtract } = require('../index');

async function main() {
    if (!process.env.NIM_API_KEY) {
        console.log('Set NIM_API_KEY to run this example — see docs/llm-providers.md.');
        return;
    }

    const result = await autoExtract('https://quotes.toscrape.com/', {
        quote: 'string',
        author: 'string',
    }, {
        instructions: 'Extract every quote and its author from the page.',
    });

    console.log(`extracted ${result.data.length} item(s), strategy=${result.extraction.strategy}`);
    console.log(result.data.slice(0, 3));
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
