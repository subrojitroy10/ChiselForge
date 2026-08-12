#!/usr/bin/env node
// Benchmark runner — hits real, live pages and an optional LLM API. Not part
// of `npm test` on purpose (see CONTRIBUTING.md): it costs time, money, and
// depends on external services staying up. Run manually:
//
//   NIM_API_KEY=... node benchmark/run.js
//
// Writes benchmark/results.json (measured data) — BENCHMARKS.md is written
// by hand FROM that file's contents, never from assumptions. If you re-run
// this, regenerate BENCHMARKS.md's numbers to match, don't leave them stale.

const fs = require('fs');
const path = require('path');
const { autoExtract } = require('../extraction/auto');
const corpus = require('./corpus');

function option(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const apiKey = option('--api-key', process.env.NIM_API_KEY);
const model = option('--model', 'nvidia/llama-3.3-nemotron-super-49b-v1');

async function runCase(testCase) {
    const start = Date.now();
    try {
        const result = await autoExtract(testCase.url, testCase.schema, {
            apiKey, model, ...testCase.options,
        });
        const latencyMs = Date.now() - start;
        const success = result.data.length >= (testCase.expectMinItems ?? 1) && result.extraction.validation.valid;
        return {
            name: testCase.name,
            url: testCase.url,
            success,
            itemCount: result.data.length,
            strategy: result.extraction.strategy,
            llmUsed: result.extraction.llmUsed,
            confidence: result.extraction.confidence,
            validationValid: result.extraction.validation.valid,
            latencyMs,
            error: null,
        };
    } catch (err) {
        return {
            name: testCase.name,
            url: testCase.url,
            success: false,
            itemCount: 0,
            strategy: null,
            llmUsed: null,
            confidence: 0,
            validationValid: false,
            latencyMs: Date.now() - start,
            error: err.message,
        };
    }
}

(async () => {
    console.log(`Running benchmark corpus (${corpus.length} case(s))...\n`);
    const results = [];

    for (const testCase of corpus) {
        process.stdout.write(`  ${testCase.name} ... `);
        const result = await runCase(testCase);
        results.push(result);
        console.log(result.success
            ? `OK (${result.strategy}, ${result.itemCount} item(s), ${result.latencyMs}ms)`
            : `FAILED (${result.error || 'validation/item-count check did not pass'})`);
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        model,
        totalCases: results.length,
        successCount: results.filter(r => r.success).length,
        llmUsedCount: results.filter(r => r.llmUsed).length,
        tierBreakdown: results.reduce((acc, r) => {
            if (r.strategy) acc[r.strategy] = (acc[r.strategy] || 0) + 1;
            return acc;
        }, {}),
        avgLatencyMs: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length),
        results,
    };

    const outPath = path.join(__dirname, 'results.json');
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

    console.log(`\n${summary.successCount}/${summary.totalCases} passed`);
    console.log(`Tier breakdown: ${JSON.stringify(summary.tierBreakdown)}`);
    console.log(`Results written to: ${outPath}`);
})();
