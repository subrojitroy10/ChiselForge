// The "auto" extraction pipeline — points at any URL, figures out how to get
// its content and what strategy to extract with, without site-specific code.
//
// Core thesis: use the cheapest, most deterministic extraction method that
// can reliably answer the request, and only escalate when necessary.
//
//   1. JSON-LD / schema.org (extraction/json-ld.js)        — free, instant, exact
//   2. Known hydration-state, handed to the LLM as context — cheaper/more
//      accurate than raw HTML because it's already-structured JSON, not markup
//      noise, even though an LLM still has to map it to your schema
//   3. Rendered/raw text, handed to the LLM cold           — last resort
//
// Be precise about which tier is actually deterministic: only tier 1
// (JSON-LD) is — no LLM involved, same input always produces the same
// output. Tiers 2 and 3 both use an LLM to map data onto the schema; tier 2
// is more reliable because it hands the LLM clean structured JSON instead of
// raw markup (see BENCHMARKS.md for the measured latency/reliability
// difference), but "more reliable than tier 3" is not "deterministic." Tier
// 3 (no JSON-LD, no recognized hydration format) is the genuine last resort,
// and where "any website" claims stop being fully honest. See
// EXTRACTION_STRATEGIES.md. Don't oversell this.

const { classifyHtml } = require('./classify');
const { extractJsonLdBlocks, findByType, findRelevantBlocks } = require('./json-ld');
const { extractWithLLM } = require('./llm');
const { validateItems } = require('./validate');
const { estimateConfidence } = require('./confidence');
const { fetchHtml } = require('../transports/http');

// Observed directly during testing: at temperature 0, against a page whose
// data was confirmed present well inside the truncation window, the LLM tier
// still occasionally returned a clean, valid `[]` (finish_reason: "stop", not
// a truncation/error) when the correct answer was 5 items. Temperature 0
// reduces but does not eliminate this on hosted inference (server-side
// batching/quantization variance is a known cause) — a single bounded retry
// is cheap insurance against an otherwise-working extraction reporting zero
// results. This does not retry on errors (the caller's own retry/backoff
// logic — e.g. core/worker-loop.js — should handle those); it only retries
// an LLM call that came back suspiciously empty.
async function extractWithRetryOnEmpty(fn, attempts = 2) {
    let result = [];
    for (let i = 0; i < attempts; i++) {
        result = await fn();
        if (Array.isArray(result) && result.length > 0) return result;
    }
    return result;
}

/**
 * @param {string} url
 * @param {object} schema                 Shape to extract, e.g. { author: "string", text: "string", rating: "number" }
 * @param {object} [options]
 * @param {string} [options.apiKey]        LLM key — see extraction/llm.js. Falls back to NIM_API_KEY env var.
 * @param {string} [options.model]         Passed through to extraction/llm.js
 * @param {string} [options.instructions]  Passed through to extraction/llm.js
 * @param {string} [options.jsonLdType]
 *        Optional schema.org @type to filter tier-1 results by (e.g. "Review").
 *        A page can carry JSON-LD that's real but irrelevant to what you asked
 *        for (e.g. Restaurant/WebSite/BreadcrumbList blocks with no Review
 *        block at all). Pass this when you know the type — it's an exact
 *        match, strictly more precise than the heuristic below. If omitted,
 *        tier 1 falls back to a field-overlap heuristic
 *        (extraction/json-ld.js's findRelevantBlocks) that checks whether a
 *        block's own keys plausibly match your schema before accepting it —
 *        best-effort, not exact, but meaningfully better than accepting any
 *        JSON-LD present regardless of relevance.
 * @param {Function} [options.renderWithBrowser]
 *        Optional `(url) => Promise<html>` — supply this to handle the
 *        needsBrowser=true case (this module doesn't launch a browser itself,
 *        to keep it usable without a playwright dependency present). If
 *        omitted and a browser turns out to be required, this throws with a
 *        clear message rather than silently returning nothing.
 * @param {number} [options.httpTimeoutMs]
 * @param {number} [options.hydrationMaxChars]
 * @param {number} [options.llmTimeoutMs]
 * @param {(step:string, detail?:object)=>void} [options.onStep]
 *        Optional progress callback — fired once per pipeline step, in order.
 *        Used by cli.js to render the ✓ checklist; harmless to ignore otherwise.
 * @returns {Promise<{
 *   data: any[],
 *   extraction: {
 *     strategy: 'json-ld'|'hydration'|'text',
 *     llmUsed: boolean,
 *     confidence: number,
 *     validation: { valid:boolean, totalItems:number, validItems:number, results:object[] },
 *     needsBrowser: boolean,
 *     hasJsonLd: boolean,
 *     hydrationKey: string|null,
 *   }
 * }>}
 */
async function autoExtract(url, schema, options = {}) {
    const {
        apiKey, model, instructions, jsonLdType, renderWithBrowser,
        httpTimeoutMs = 30000, onStep = () => {},
    } = options;

    onStep('fetching', { url });
    const { html: rawHtml } = await fetchHtml(url, { timeoutMs: httpTimeoutMs });
    let html = rawHtml;
    let classification = classifyHtml(html);
    onStep('classified', classification);

    if (classification.needsBrowser) {
        if (!renderWithBrowser) {
            throw new Error(
                'This page appears to require a browser (little/no content in the raw ' +
                'HTTP response). Pass options.renderWithBrowser = async (url) => html to ' +
                'handle this — see transports/browser.js for a Playwright-based example.'
            );
        }
        onStep('rendering-with-browser');
        html = await renderWithBrowser(url);
        classification = classifyHtml(html); // re-classify against the rendered HTML
        onStep('classified', classification);
    }

    const finish = (strategy, items) => {
        const validation = validateItems(items, schema);
        const confidence = estimateConfidence(strategy, validation);
        onStep('validated', validation);
        return {
            data: items,
            extraction: {
                strategy,
                llmUsed: strategy !== 'json-ld',
                confidence,
                validation,
                needsBrowser: classification.needsBrowser,
                hasJsonLd: classification.hasJsonLd,
                hydrationKey: classification.hydration?.key ?? null,
            },
        };
    };

    // Tier 1: JSON-LD — deterministic, free, exact. No LLM involved.
    // "JSON-LD is present" isn't the same as "JSON-LD answers this schema" —
    // a page can carry real JSON-LD for unrelated things (WebSite, Breadcrumbs)
    // with no block matching what was asked for. Relevance, not mere
    // presence, decides whether tier 1 short-circuits:
    //   - jsonLdType given: exact @type match (findByType) — most precise,
    //     prefer this whenever you know the schema.org type you want.
    //   - jsonLdType omitted: best-effort field-overlap heuristic
    //     (findRelevantBlocks) — not exact, but catches the common case
    //     (e.g. a Restaurant/Product block whose own fields plainly match
    //     the requested schema) without requiring the caller to know
    //     schema.org vocabulary up front.
    if (classification.hasJsonLd) {
        const blocks = extractJsonLdBlocks(html);
        const relevant = jsonLdType ? findByType(blocks, jsonLdType) : findRelevantBlocks(blocks, schema);
        if (relevant.length > 0) {
            onStep('extracted', { strategy: 'json-ld', count: relevant.length });
            return finish('json-ld', relevant);
        }
        onStep('json-ld-irrelevant', { blocksFound: blocks.length });
    }

    // Tier 2: known hydration-state object, handed to the LLM as structured
    // context instead of raw markup — the LLM only has to map fields, not
    // parse HTML noise.
    if (classification.hydration) {
        onStep('extracting', { strategy: 'hydration' });
        // Generic (not site-specific) instruction addition: hydration-state
        // objects are often deeply nested with many irrelevant top-level keys
        // (a whole app's initial state, not just the section you asked about).
        // Found via real testing that without an explicit nudge to search
        // nested structure, the model can miss data that's genuinely present
        // and well within the truncation window — this isn't a Zomato-specific
        // fix, it's the same failure mode any deeply-nested hydration state
        // would trigger.
        const hydrationInstructions = [
            'The input is a JSON object representing an application\'s hydration state.',
            'The data you need may be nested several levels deep inside it — search all nested objects and arrays, not just top-level fields, before concluding nothing matches.',
            instructions || '',
        ].filter(Boolean).join(' ');
        // Hydration-state JSON is far denser/less noisy per character than raw
        // HTML, and can genuinely be large (it's a whole app's initial state,
        // not just the one section you care about) — the default text-tier
        // truncation (extraction/llm.js's 12k-char default) is tuned for noisy
        // HTML and cuts structured state off before reaching relevant fields.
        // Give this tier a much bigger budget by default.
        const items = await extractWithRetryOnEmpty(() => extractWithLLM(
            JSON.stringify(classification.hydration.state),
            schema,
            {
                apiKey, model, instructions: hydrationInstructions, isHtml: false,
                maxChars: options.hydrationMaxChars ?? 60000,
                // Larger prompts take longer, especially on reasoning models —
                // the 60s default (tuned for small prompts) isn't enough here.
                timeoutMs: options.llmTimeoutMs ?? 120000,
                // Multiple full-text items (e.g. several reviews) can easily
                // exceed the 4096-token default — give this tier more room.
                maxTokens: options.llmMaxTokens ?? 8192,
            }
        ));
        onStep('extracted', { strategy: 'hydration', count: items.length });
        return finish('hydration', items);
    }

    // Tier 3: no structured markup, no known hydration format — last resort,
    // hand the LLM the page's visible text cold.
    onStep('extracting', { strategy: 'text' });
    const items = await extractWithRetryOnEmpty(() =>
        extractWithLLM(html, schema, { apiKey, model, instructions, isHtml: true })
    );
    onStep('extracted', { strategy: 'text', count: items.length });
    return finish('text', items);
}

module.exports = { autoExtract };
