#!/usr/bin/env node
// chiselforge CLI — the zero-config entry point.
//
//   chiselforge extract <url> [--schema "name, price, rating"]
//   chiselforge extract <url> [--schema-file product.json]
//   chiselforge extract <url> --verbose
//   chiselforge extract <url> --output result.json
//
// Hand-rolled arg parsing, no CLI framework dependency — consistent with the
// rest of this project's zero-dependency-by-default approach (see
// web-UI/automate.js's option() helper for the precedent this follows).

const fs = require('fs');
const path = require('path');
const { autoExtract } = require('./extraction/auto');

function option(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
function flag(name) {
    return process.argv.includes(name);
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

Options:
  --schema "field, field:type, ..."   Quick schema, e.g. "name, price:number, rating:number"
  --schema-file <path.json>            Schema as a JSON file: { "name": "string", "price": "number" }
  --json-ld-type <Type>                Only accept JSON-LD blocks of this schema.org @type (e.g. "Review")
  --output <path.json>                 Write result here (default: prints to stdout)
  --api-key <key>                      LLM API key (falls back to NIM_API_KEY env var)
  --base-url <url>                     LLM endpoint (default: NVIDIA NIM) — point at OpenAI, a local Ollama
                                        server, or any other OpenAI-compatible host to switch providers
  --model <model-id>                   LLM model (default: nvidia/llama-3.3-nemotron-super-49b-v1)
  --instructions "<text>"              Extra guidance for the LLM tiers (e.g. "only dining reviews, not delivery")
  --verbose                            Show every pipeline step, not just the summary
  --help                               Show this message

Example:
  chiselforge extract https://example.com/product/123 \\
    --schema "name, price:number, rating:number, reviews:array"
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

async function main() {
    const args = process.argv.slice(2);

    if (flag('--help') || args.length === 0) {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    if (args[0] !== 'extract') {
        console.error(`Unknown command "${args[0]}". Try: chiselforge extract <url>`);
        process.exit(1);
    }

    const url = args[1];
    if (!url || url.startsWith('--')) {
        console.error('Usage: chiselforge extract <url> [options]');
        process.exit(1);
    }

    const verbose = flag('--verbose');
    const schema = loadSchema();
    const jsonLdType = option('--json-ld-type', undefined);
    const apiKey = option('--api-key', process.env.NIM_API_KEY);
    const baseUrl = option('--base-url', undefined);
    const model = option('--model', undefined);
    const instructions = option('--instructions', undefined);
    const outputPath = option('--output', null);

    if (!verbose) console.log(`Loading ${url} ...`);

    const onStep = (step, detail) => {
        if (!verbose) return;
        const label = STEP_LABELS[step] ? STEP_LABELS[step](detail) : step;
        console.log(`  ✓ ${label}`);
    };

    let result;
    try {
        result = await autoExtract(url, schema, { apiKey, baseUrl, model, jsonLdType, instructions, onStep });
    } catch (err) {
        console.error(`\n✗ Extraction failed: ${err.message}\n`);
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
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
