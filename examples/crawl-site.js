// crawlSite() discovers every same-host page from a seed URL and runs each
// one through the same tiered autoExtract pipeline — no site-specific code.
// quotes.toscrape.com is small, paginated, and built for scraper practice.
// No JSON-LD on this site, so every page needs the LLM tier — needs
// NIM_API_KEY. maxPages is kept small on purpose to bound cost/time.
//
//   NIM_API_KEY=your-key node examples/crawl-site.js

const { crawlSite } = require('../index');

async function main() {
    if (!process.env.NIM_API_KEY) {
        console.log('Set NIM_API_KEY to run this example — see docs/llm-providers.md.');
        return;
    }

    const result = await crawlSite('https://quotes.toscrape.com/', {
        quote: 'string',
        author: 'string',
    }, {
        maxPages: 3,
        workers: 2,
        onProgress: (event, detail) => console.log(event, detail?.url || ''),
    });

    console.log(`discovered ${result.pagesDiscovered}, extracted ${result.pagesExtracted}, failed ${result.pagesFailed}`);
    for (const page of result.pages) {
        console.log(page.url, '->', page.data.length, 'item(s)', page.error ? `(error: ${page.error})` : '');
    }
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
