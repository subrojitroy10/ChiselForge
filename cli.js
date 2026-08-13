#!/usr/bin/env node
// chiselforge CLI — the zero-config entry point.
//
//   chiselforge extract <url> [--schema "name, price, rating"]
//   chiselforge extract <url> [--schema-file product.json]
//   chiselforge extract <url> --verbose
//   chiselforge extract <url> --output result.json
//   chiselforge crawl <seed-url> [--schema "..."] [--max-pages 50] [--output dir]
//
// Hand-rolled arg parsing, no CLI framework dependency — consistent with the
// rest of this project's zero-dependency-by-default approach (see
// web-UI/automate.js's option() helper for the precedent this follows).

const fs = require('fs');
const path = require('path');
const { autoExtract } = require('./extraction/auto');
const { crawlSite } = require('./crawl/crawlSite');

function option(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
function flag(name) {
    return process.argv.includes(name);
}

// Lazily launches ONE shared headless browser (reused across every page of a
// crawl, not relaunched per page) and returns a renderWithBrowser(url) function
// for autoExtract's needsBrowser fallback. playwright is only required here —
// `extract`/`crawl` runs that never hit a needsBrowser=true page never pay for
// it. Caller is responsible for calling the returned close() when done.
function createBrowserRenderer() {
    let browserPromise = null;
    async function getBrowser() {
        if (!browserPromise) {
            const { chromium } = require('playwright');
            browserPromise = chromium.launch({ headless: true });
        }
        return browserPromise;
    }
    const renderWithBrowser = async (url) => {
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(1000); // let client-side rendering settle
            return await page.content();
        } finally {
            await page.close();
        }
    };
    const close = async () => {
        if (browserPromise) { try { await (await browserPromise).close(); } catch (_) {} }
    };
    return { renderWithBrowser, close };
}

const DEFAULT_SCHEMA = {
    title: 'string',
    text: 'string',
};

// "name, price, rating" -> { name: "string", price: "string", rating: "string" }
// "name:string, price:number, rating:number" -> typed version
// Deliberately simple: real precision should come from --schema-file for
// anything beyond quick exploratory use.
function parseShorthandSchema(raw) {
    const schema = {};
    for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const [field, type] = trimmed.split(':').map(s => s.trim());
        schema[field] = type || 'string';
    }
    return schema;
}

function loadSchema() {
    const schemaFile = option('--schema-file', null);
    if (schemaFile) {
        const resolved = path.resolve(process.cwd(), schemaFile);
        return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    }

    const shorthand = option('--schema', null);
    if (shorthand) return parseShorthandSchema(shorthand);

    return DEFAULT_SCHEMA;
}

function printUsage() {
    console.log(`
chiselforge — extract structured data from a webpage without writing a scraper

Usage:
  chiselforge extract <url> [options]
  chiselforge crawl <seed-url> [options]

extract options:
  --schema "field, field:type, ..."   Quick schema, e.g. "name, price:number, rating:number"
  --schema-file <path.json>            Schema as a JSON file: { "name": "string", "price": "number" }
  --json-ld-type <Type>                Only accept JSON-LD blocks of this schema.org @type (e.g. "Review")
  --output <path.json>                 Write result here (default: prints to stdout)
  --verbose                            Show every pipeline step, not just the summary

crawl options (all of the above, plus):
  --max-pages <n>                       Page discovery cap (default: 50)
  --workers <n>                         Concurrent pages processed at once (default: 3)
  --output <dir>                         Write index.json + one file per page here (default: prints index to stdout)
  --checkpoint-dir <dir>                 Resume a previous crawl by reusing its checkpoint dir (default: a fresh
                                          unique dir every run — safe by default, not resumable unless you opt in)

shared LLM options:
  --api-key <key>                      LLM API key (falls back to NIM_API_KEY env var)
  --base-url <url>                     LLM endpoint (default: NVIDIA NIM) — point at OpenAI, a local Ollama
                                        server, or any other OpenAI-compatible host to switch providers
  --model <model-id>                   LLM model (default: nvidia/llama-3.3-nemotron-super-49b-v1)
  --instructions "<text>"              Extra guidance for the LLM tiers (e.g. "only dining reviews, not delivery")
  --llm-timeout-ms <n>                 LLM request timeout (default: 120000 — large rendered pages can need it)
  --llm-max-tokens <n>                 LLM completion token budget (default: 4096, 8192 for the hydration tier)
  --help                               Show this message

Examples:
  chiselforge extract https://example.com/product/123 \\
    --schema "name, price:number, rating:number, reviews:array"

  chiselforge crawl https://example.com/ --max-pages 30 --output ./crawl-result
`);
}

const STEP_LABELS = {
    fetching: d => `Fetching ${d.url}`,
    classified: c => c.hydration
        ? `Detected hydration state (${c.hydration.key})`
        : c.hasJsonLd
            ? 'Detected JSON-LD structured data'
            : c.needsBrowser
                ? 'Page appears to need a browser (empty SPA shell)'
                : 'Classified as plain server-rendered page',
    'rendering-with-browser': () => 'Rendering with browser',
    'json-ld-irrelevant': d => `JSON-LD found (${d.blocksFound} block(s)) but none matched — escalating`,
    extracting: d => `Extracting via ${d.strategy} tier`,
    extracted: d => `Extracted ${d.count} record(s) via ${d.strategy} tier`,
    validated: v => v.valid
        ? 'Validation passed'
        : `Validation: ${v.validItems}/${v.totalItems} item(s) matched schema`,
};

function sharedLlmOptions() {
    const llmTimeoutMs = option('--llm-timeout-ms', undefined);
    const llmMaxTokens = option('--llm-max-tokens', undefined);
    return {
        apiKey: option('--api-key', process.env.NIM_API_KEY),
        baseUrl: option('--base-url', undefined),
        model: option('--model', undefined),
        instructions: option('--instructions', undefined),
        llmTimeoutMs: llmTimeoutMs ? Number(llmTimeoutMs) : undefined,
        llmMaxTokens: llmMaxTokens ? Number(llmMaxTokens) : undefined,
    };
}

async function runExtract(args) {
    const url = args[1];
    if (!url || url.startsWith('--')) {
        console.error('Usage: chiselforge extract <url> [options]');
        process.exit(1);
    }

    const verbose = flag('--verbose');
    const schema = loadSchema();
    const jsonLdType = option('--json-ld-type', undefined);
    const outputPath = option('--output', null);

    if (!verbose) console.log(`Loading ${url} ...`);

    const onStep = (step, detail) => {
        if (!verbose) return;
        const label = STEP_LABELS[step] ? STEP_LABELS[step](detail) : step;
        console.log(`  ✓ ${label}`);
    };

    const renderer = createBrowserRenderer();
    let result;
    try {
        result = await autoExtract(url, schema, {
            ...sharedLlmOptions(), jsonLdType, onStep,
            renderWithBrowser: renderer.renderWithBrowser,
        });
    } catch (err) {
        console.error(`\n✗ Extraction failed: ${err.message}\n`);
        await renderer.close();
        process.exit(1);
    }

    if (!verbose) {
        console.log(`✓ Loaded page`);
        console.log(`✓ ${result.extraction.strategy === 'json-ld' ? 'Found structured data (JSON-LD)' : `Extracted via ${result.extraction.strategy} tier${result.extraction.llmUsed ? ' (LLM used)' : ''}`}`);
        console.log(`✓ Extracted ${result.data.length} record(s)`);
        console.log(result.extraction.validation.valid ? '✓ Validation passed' : `⚠ Validation: ${result.extraction.validation.validItems}/${result.extraction.validation.totalItems} matched schema`);
    }

    if (outputPath) {
        const resolved = path.resolve(process.cwd(), outputPath);
        fs.writeFileSync(resolved, JSON.stringify(result, null, 2));
        console.log(`\nOutput: ${resolved}`);
    } else {
        console.log('\n' + JSON.stringify(result, null, 2));
    }

    await renderer.close();
}

function slugForUrl(url) {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 150) || 'page';
}

async function runCrawl(args) {
    const seed = args[1];
    if (!seed || seed.startsWith('--')) {
        console.error('Usage: chiselforge crawl <seed-url> [options]');
        process.exit(1);
    }

    const schema = loadSchema();
    const jsonLdType = option('--json-ld-type', undefined);
    const maxPages = Number(option('--max-pages', 50));
    const workers = Number(option('--workers', 3));
    const outputDir = option('--output', null);
    // Defaults to a unique dir per run (crawlSite's own default) — pass this
    // explicitly to opt into resuming a previous crawl instead.
    const checkpointDir = option('--checkpoint-dir', undefined);

    console.log(`Crawling ${seed} (max ${maxPages} pages, ${workers} workers)...\n`);

    const onProgress = (event, detail) => {
        if (event === 'discovered') {
            console.log(`Discovered ${detail.pageCount} page(s) — ${detail.sitemapPageCount} via sitemap, ${detail.crawledPageCount} via link crawl\n`);
        } else if (event === 'page-done') {
            console.log(`  ✓ ${detail.url} — ${detail.strategy}${detail.llmUsed ? ' (LLM)' : ''}`);
        } else if (event === 'page-error') {
            console.log(`  ✗ ${detail.url} — ${detail.error}`);
        }
    };

    const renderer = createBrowserRenderer();
    let result;
    try {
        result = await crawlSite(seed, schema, {
            maxPages, workers, onProgress, checkpointDir,
            extractOptions: { ...sharedLlmOptions(), jsonLdType, renderWithBrowser: renderer.renderWithBrowser },
        });
    } finally {
        await renderer.close();
    }

    const index = {
        seed: result.seed,
        pagesDiscovered: result.pagesDiscovered,
        pagesExtracted: result.pagesExtracted,
        pagesFailed: result.pagesFailed,
        discoveryFailures: result.discoveryFailures,
        pages: result.pages.map(p => ({
            url: p.url, title: p.title, strategy: p.strategy, llmUsed: p.llmUsed,
            browserUsed: p.browserUsed, confidence: p.confidence,
            itemCount: p.data.length, warnings: p.warnings, error: p.error,
        })),
    };

    console.log(`\n${result.pagesExtracted}/${result.pagesDiscovered} pages extracted successfully`);

    if (outputDir) {
        const resolved = path.resolve(process.cwd(), outputDir);
        fs.mkdirSync(path.join(resolved, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(resolved, 'index.json'), JSON.stringify(index, null, 2));
        for (const page of result.pages) {
            fs.writeFileSync(path.join(resolved, 'pages', `${slugForUrl(page.url)}.json`), JSON.stringify(page, null, 2));
        }
        console.log(`Index: ${path.join(resolved, 'index.json')}`);
        console.log(`Pages: ${path.join(resolved, 'pages')}`);
    } else {
        console.log('\n' + JSON.stringify(index, null, 2));
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (flag('--help') || args.length === 0) {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    if (args[0] === 'extract') return runExtract(args);
    if (args[0] === 'crawl') return runCrawl(args);

    console.error(`Unknown command "${args[0]}". Try: chiselforge extract <url> or chiselforge crawl <seed-url>`);
    process.exit(1);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
