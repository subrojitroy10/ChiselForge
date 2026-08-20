// A from-scratch adapter following docs/adapter-interface.md's shape
// (resolve / paginate / extractItems / isDone) — this repo ships no
// production adapter (see docs/adapters.md for why), so this is a small,
// honest, working illustration against a stable public site instead.
//
// quotes.toscrape.com's quotes have no stable per-item ID, so this uses the
// content-hash termination strategy (core/pagination.js's isRepeatedPage) —
// stop paginating once a page's item set matches the previous page's,
// meaning the site started repeating its last page.
//
// Deliberately bypasses autoExtract entirely — no LLM, no cost, fully
// deterministic — to show the engine's lower layers (a transport +
// core/pagination.js + runWorkerPool) composed directly, the way a real
// adapter would.
//
//   node examples/custom-adapter.js

const { http: httpTransport, runWorkerPool } = require('../index');
const { isRepeatedPage } = require('../core/pagination');

function extractItems(html) {
    const items = [];
    const blockRe = /<div class="quote"[^>]*>[\s\S]*?<span class="text"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<small class="author"[^>]*>([\s\S]*?)<\/small>/g;
    let m;
    while ((m = blockRe.exec(html))) {
        items.push({ quote: m[1].trim(), author: m[2].trim() });
    }
    return items;
}

function serializeItem(item) {
    return `${item.quote}|${item.author}`;
}

async function paginateAndExtract(startUrl, maxPages) {
    const allItems = [];
    let previousHash = null;
    let url = startUrl;

    for (let page = 1; page <= maxPages && url; page++) {
        const { html } = await httpTransport.fetchHtml(url);
        const items = extractItems(html);

        const { isDuplicate, hash } = isRepeatedPage(items, serializeItem, previousHash);
        if (isDuplicate) break; // isDone(): the site started repeating its last page
        previousHash = hash;

        allItems.push(...items);
        url = /\/page\/\d+\/?$/.test(url)
            ? url.replace(/\/page\/\d+\/?$/, `/page/${page + 1}/`)
            : `${startUrl.replace(/\/$/, '')}/page/${page + 1}/`;
    }

    return allItems;
}

async function main() {
    // runWorkerPool()'s own return value is just counts (done/failed/skipped)
    // — it has no opinion about job output shape, so a real adapter (like
    // crawlSite.js does) collects its own results inside processJob.
    const resultsBySeed = new Map();

    // Wired through runWorkerPool the way a real multi-target adapter would
    // be — one "job" per seed here, but the same shape scales to many.
    const stats = await runWorkerPool({
        jobs: [{ seed: 'https://quotes.toscrape.com/' }],
        workerCount: 1,
        getCheckpointKey: job => job.seed,
        checkpointDir: require('path').join(require('os').tmpdir(), 'chiselforge-examples', `custom-adapter-${Date.now()}`),
        processJob: async (job) => {
            const items = await paginateAndExtract(job.seed, 5);
            resultsBySeed.set(job.seed, items);
            return items;
        },
    });

    console.log('worker pool stats:', stats);
    for (const [seed, items] of resultsBySeed) {
        console.log(`${seed} -> ${items.length} item(s)`);
        console.log(items.slice(0, 2));
    }
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
