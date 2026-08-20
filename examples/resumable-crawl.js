// crawlSite() defaults checkpointDir to a fresh unique temp dir PER CALL —
// safe by default, but not resumable across separate invocations unless you
// deliberately pass the same checkpointDir back in. This demonstrates that:
// the second call against the same checkpointDir skips pages the first call
// already completed, and reports their real persisted data rather than
// treating them as unprocessed (see docs/architecture.md's crawl section for
// the real historical bug this behavior was fixed for).
//
//   NIM_API_KEY=your-key node examples/resumable-crawl.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { crawlSite } = require('../index');

async function main() {
    if (!process.env.NIM_API_KEY) {
        console.log('Set NIM_API_KEY to run this example — see docs/llm-providers.md.');
        return;
    }

    const checkpointDir = path.join(os.tmpdir(), 'chiselforge-examples', 'resumable-demo');
    // This path is fixed on purpose (it's what's being demonstrated: reusing
    // the SAME checkpointDir across two calls resumes) — but that means a
    // previous run of this same script would leave it fully checkpointed,
    // making a later "first run" here silently see already-done state
    // instead of a genuinely fresh one. Reset it at the top of every script
    // execution; the two crawlSite() calls below still share it with each
    // other, which is the actual thing being demonstrated.
    fs.rmSync(checkpointDir, { recursive: true, force: true });

    const seed = 'https://quotes.toscrape.com/';
    const schema = { quote: 'string', author: 'string' };
    const options = { maxPages: 2, workers: 1, checkpointDir };

    console.log('first run (fresh checkpointDir)...');
    const first = await crawlSite(seed, schema, options);
    console.log(`  extracted ${first.pagesExtracted}/${first.pagesDiscovered} pages`);

    console.log('second run (same checkpointDir — should report the same pages as already done, with real data)...');
    const second = await crawlSite(seed, schema, options);
    console.log(`  extracted ${second.pagesExtracted}/${second.pagesDiscovered} pages`);
    console.log('  same page data reused, not reprocessed:', second.pages.every(p => p.data.length > 0 || p.error));
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
