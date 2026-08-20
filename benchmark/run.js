#!/usr/bin/env node
// Benchmark runner — hits real, live pages, a real local Playwright browser
// render, and an LLM API. Not part of `npm test` on purpose (see
// CONTRIBUTING.md): costs time, money, and depends on external services
// staying up. Run manually:
//
//   NIM_API_KEY=... node benchmark/run.js
//
// Writes benchmark/results.json (measured data) — docs/benchmarks.md is written
// by hand FROM that file's contents, never from assumptions. If you re-run
// this, regenerate docs/benchmarks.md's numbers to match, don't leave them stale.

const fs = require('fs');
const path = require('path');
const { autoExtract } = require('../extraction/auto');
const { startLocalServer } = require('./local-server');
const corpus = require('./corpus');

function option(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const apiKey = option('--api-key', process.env.NIM_API_KEY);
const model = option('--model', 'nvidia/llama-3.3-nemotron-super-49b-v1');

// Lazy — only touched if a case actually needs browser rendering, so this
// script still runs against a corpus with no such cases without playwright
// installed.
let sharedBrowser = null;
async function getRenderWithBrowser() {
    if (!sharedBrowser) {
        const { chromium } = require('playwright');
        sharedBrowser = await chromium.launch({ headless: true });
    }
    return async (url) => {
        const page = await sharedBrowser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(500); // let the fixture's client-side render run
            return await page.content();
        } finally {
            await page.close();
        }
    };
}

function checkExpectations(testCase, result) {
    const issues = [];

    if (testCase.isHonestFailureCase) {
        // Correct behavior for this case IS zero/low-confidence extraction —
        // check that it did NOT hallucinate items matching a schema the page
        // has no data for, not that it "succeeded" in the normal sense.
        if (result.data.length > 0) {
            issues.push(`expected an honest empty/near-empty result, got ${result.data.length} item(s) — possible hallucination`);
        }
        return issues;
    }

    if (result.data.length < (testCase.expectMinItems ?? 1)) {
        issues.push(`expected >= ${testCase.expectMinItems ?? 1} items, got ${result.data.length}`);
    }
    if (!result.extraction.validation.valid && result.data.length > 0) {
        issues.push('validation did not pass');
    }
    if (testCase.expectStrategy && result.extraction.strategy !== testCase.expectStrategy) {
        issues.push(`expected strategy "${testCase.expectStrategy}", got "${result.extraction.strategy}"`);
    }
    if (testCase.expectLlmUsed === false && result.extraction.llmUsed) {
        issues.push('expected no LLM use, but an LLM tier fired');
    }
    if (testCase.expectBrowserUsed && !result.extraction.browserUsed) {
        issues.push('expected browserUsed=true (this case is supposed to test the browser-rendering path)');
    }

    return issues;
}

async function runCase(testCase, localServer) {
    const start = Date.now();
    try {
        const url = testCase.needsLocalServer ? localServer.url(testCase.localFixture) : testCase.url;
        const extraOptions = testCase.needsLocalServer ? { renderWithBrowser: await getRenderWithBrowser() } : {};

        const result = await autoExtract(url, testCase.schema, {
            apiKey, model, ...testCase.options, ...extraOptions,
        });
        const latencyMs = Date.now() - start;
        const issues = checkExpectations(testCase, result);

        return {
            name: testCase.name,
            url: url,
            success: issues.length === 0,
            issues,
            itemCount: result.data.length,
            strategy: result.extraction.strategy,
            llmUsed: result.extraction.llmUsed,
            confidence: result.extraction.confidence,
            needsBrowser: result.extraction.needsBrowser,
            browserUsed: result.extraction.browserUsed,
            validationValid: result.extraction.validation.valid,
            latencyMs,
            error: null,
        };
    } catch (err) {
        return {
            name: testCase.name,
            url: testCase.url || `(local: ${testCase.localFixture})`,
            success: false,
            issues: [`threw: ${err.message}`],
            itemCount: 0,
            strategy: null,
            llmUsed: null,
            confidence: 0,
            needsBrowser: null,
            browserUsed: null,
            validationValid: false,
            latencyMs: Date.now() - start,
            error: err.message,
        };
    }
}

(async () => {
    console.log(`Running benchmark corpus (${corpus.length} case(s))...\n`);

    const localServer = await startLocalServer(path.join(__dirname, 'fixtures'));
    const results = [];

    try {
        for (const testCase of corpus) {
            process.stdout.write(`  ${testCase.name} ... `);
            const result = await runCase(testCase, localServer);
            results.push(result);
            console.log(result.success
                ? `OK (${result.strategy}, ${result.itemCount} item(s), ${result.latencyMs}ms)`
                : `FAILED (${result.issues.join('; ') || result.error})`);
        }
    } finally {
        await localServer.close();
        if (sharedBrowser) await sharedBrowser.close();
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

    process.exit(summary.successCount === summary.totalCases ? 0 : 1);
})();
