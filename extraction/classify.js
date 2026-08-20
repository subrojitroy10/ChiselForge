// Site classifier — "what kind of page is this," decided from the raw HTTP
// response alone (no browser launch needed just to classify).
//
// Extends the signature-detection technique from web-UI/inspect.js (which
// detects frontend libraries by scanning bundle text) to a narrower, more
// load-bearing question: does this page's content exist in the raw HTML
// (SSR), and if so, is it sitting in a known hydration-state global
// (generalizing the Zomato `window.__PRELOADED_STATE__` discovery to the
// other common frameworks that do the same thing)?
//
// This only tells you HOW to get the data (http-only vs browser-required,
// hydration-state vs DOM/JSON-LD). It does not know WHAT the data means —
// see extraction/auto.js for how this feeds into the extraction tier chain.

const { BOT_BLOCK_STATUSES } = require('../transports/http');

const KNOWN_HYDRATION_GLOBALS = [
    '__PRELOADED_STATE__',   // Zomato and others
    '__NUXT__',              // Nuxt/Vue
    '__APOLLO_STATE__',      // Apollo GraphQL client cache
    '__INITIAL_STATE__',     // common custom SSR convention
    '__REDUX_STATE__',       // common custom SSR convention
];

// Next.js has its own dedicated convention: a <script id="__NEXT_DATA__"
// type="application/json"> tag rather than a `window.X = ...` assignment.
function extractNextData(html) {
    const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try { return { key: '__NEXT_DATA__', state: JSON.parse(m[1].trim()) }; } catch (_) { return null; }
}

// Two shapes seen in practice for `window.KEY = ...` hydration assignments:
//  1. window.KEY = JSON.parse("...")   — an escaped JSON string literal (Zomato)
//  2. window.KEY = {...};              — a direct object literal (must itself be valid JSON to parse safely)
function extractWindowGlobal(html, key) {
    const escapedRe = new RegExp(`window\\.${key}\\s*=\\s*JSON\\.parse\\(("(?:\\\\.|[^"\\\\])*")\\)`, 's');
    const escapedMatch = html.match(escapedRe);
    if (escapedMatch) {
        try { return JSON.parse(JSON.parse(escapedMatch[1])); } catch (_) { /* fall through */ }
    }

    const directRe = new RegExp(`window\\.${key}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`, '');
    const directMatch = html.match(directRe);
    if (directMatch) {
        try { return JSON.parse(directMatch[1]); } catch (_) { /* not valid standalone JSON — skip rather than risk unsafe eval */ }
    }

    return null;
}

function detectHydrationState(html) {
    const nextData = extractNextData(html);
    if (nextData) return nextData;

    for (const key of KNOWN_HYDRATION_GLOBALS) {
        const state = extractWindowGlobal(html, key);
        if (state) return { key, state };
    }
    return null;
}

// Strips tags/scripts/styles from raw HTML source. This is NOT a CSS
// visibility computation — it doesn't know about display:none, visibility:
// hidden, or anything that requires an actual rendered DOM (a real browser
// would). It just approximates "roughly how much text content is in the
// source," which is what the empty-shell heuristic below actually needs —
// named stripToSourceText (not stripToVisibleText) so the name doesn't
// overclaim precision this function doesn't have.
function stripToSourceText(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Heuristic SPA-shell detector: very little source text plus a bare mount
// point (#root/#app/#__next with nothing inside) strongly suggests content
// is rendered client-side after JS runs, i.e. a browser is required.
function looksLikeEmptyShell(html) {
    const sourceText = stripToSourceText(html);
    const hasBareMountPoint = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html);
    return sourceText.length < 200 && hasBareMountPoint;
}

/**
 * @param {string} html   Raw HTML from a plain HTTP fetch (no browser)
 * @param {object} [options]
 * @param {number} [options.status]
 *        HTTP status of the response `html` came from, if known (see
 *        transports/http.js's fetchHtml). A bot-block-shaped status (403,
 *        429, 503) is treated as its own needsBrowser signal, independent of
 *        what the response body looks like — see BOT_BLOCK_STATUSES.
 * @returns {{
 *   needsBrowser: boolean,
 *   hasJsonLd: boolean,
 *   hydration: { key: string, state: object } | null,
 *   sourceTextLength: number,
 *   blockedStatus: number | null
 * }}
 */
function classifyHtml(html, options = {}) {
    const { status } = options;
    const hydration = detectHydrationState(html);
    const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
    const sourceTextLength = stripToSourceText(html).length;
    const blockedStatus = status != null && BOT_BLOCK_STATUSES.has(status) ? status : null;
    // Real bug found via live testing (stron.in, a Vite/React SPA): JSON-LD
    // presence does NOT imply the page's actual content is server-rendered.
    // Plenty of SPAs statically inject SEO JSON-LD into an otherwise-empty
    // index.html shell — <div id="root"></div> plus a <head> full of meta
    // tags and structured data, with zero real content until JS mounts.
    // Gating needsBrowser on `!hasJsonLd` meant such a page was wrongly
    // classified as not needing a browser, which sent ~43 characters of
    // real content into the text-LLM tier and predictably produced
    // fabricated/hallucinated output. Hydration state is a legitimate
    // reason to skip the browser (it IS the real content, no rendering
    // needed) — JSON-LD presence is not, and the two must not be conflated.
    //
    // Second real gap found live (lovable.dev, bot-protected): a 403/429/503
    // response is not an "empty shell" by looksLikeEmptyShell's heuristic —
    // it's a whole different problem (blocked, not merely unrendered) — so it
    // needs its own signal here rather than relying on the body shape.
    const needsBrowser = !hydration && (looksLikeEmptyShell(html) || blockedStatus !== null);

    return { needsBrowser, hasJsonLd, hydration, sourceTextLength, blockedStatus };
}

module.exports = {
    classifyHtml,
    detectHydrationState,
    stripToSourceText,
    looksLikeEmptyShell,
    KNOWN_HYDRATION_GLOBALS,
};
