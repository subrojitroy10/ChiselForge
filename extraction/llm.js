// Tier-3 extraction: LLM-based structured extraction — the last resort for
// pages with no JSON-LD (extraction/json-ld.js) and no known hydration-state
// shape. Costs money and latency per call and is non-deterministic, so an
// adapter should only reach this tier after the cheaper deterministic tiers
// have been tried and failed. See docs/adapter-interface.md.
//
// Provider-agnostic: targets any OpenAI-compatible /chat/completions endpoint.
// Defaults to NVIDIA NIM (https://integrate.api.nvidia.com/v1) since that's
// what this was built and tested against, but nothing here is NVIDIA-specific
// — point `baseUrl`/`model` at OpenAI, a local Ollama server, or any other
// OpenAI-compatible host and it works the same way.
//
// SECURITY: the API key is never hardcoded here or anywhere else in this
// repo. Callers must supply it via `options.apiKey` or the NIM_API_KEY
// environment variable. Do not commit a key to this repo under any
// circumstance — see README.md's "LLM extraction" section.

const { htmlToText } = require('./html-to-text');

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
// NIM personal/deployment keys are often scoped to specific "functions" rather
// than the full public catalog — Nemotron models were confirmed working
// (fast, 200 OK) across multiple test keys, so that's the safer default.
// Non-Nemotron catalog models (e.g. meta/llama-3.3-70b-instruct) may return a
// 404 ("Function ... not found for account") or hang until gateway timeout if
// your key isn't scoped to them — pass options.model explicitly if you know
// your key supports something else.
const DEFAULT_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';

function buildSystemPrompt(schema, instructions) {
    return [
        'You extract structured data from web page text.',
        'Return ONLY a JSON array of objects matching this shape — no prose, no markdown code fences, no commentary:',
        JSON.stringify(schema, null, 2),
        // Found via benchmark testing: a softer phrasing here ("if the page
        // describes a single entity, return it as a one-item array") was NOT
        // reliably followed — it still returned [] for a simple single-entity
        // page in direct testing. This more directive phrasing was, verified
        // against the same page/schema that failed with the softer version.
        'Extract exactly one record describing the page itself if that is what the schema calls for, even if the page is not a list of repeated items — do not return an empty array just because there is only one relevant thing on the page.',
        'Only return an empty array [] if the page genuinely has no data matching this schema at all.',
        instructions || '',
    ].filter(Boolean).join('\n\n');
}

// Models sometimes wrap the JSON in markdown fences or add a sentence before/after
// despite instructions not to — this recovers the JSON from that anyway rather
// than failing outright.
function parseJsonFromLLMResponse(content) {
    const cleaned = String(content || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '');

    try {
        return JSON.parse(cleaned);
    } catch (_) {
        const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (match) {
            try { return JSON.parse(match[1]); } catch (_) {}
        }
        throw new Error(`Could not parse LLM response as JSON. Raw response (first 300 chars): ${cleaned.slice(0, 300)}`);
    }
}

/**
 * @param {string} pageContent          Raw HTML or already-cleaned text
 * @param {object} schema                Example object shape describing what to extract, e.g. { author: "string", text: "string", rating: "number 1-5" }
 * @param {object} [options]
 * @param {string} [options.apiKey]      Falls back to process.env.NIM_API_KEY. Required — throws if neither is set.
 * @param {string} [options.baseUrl]     Defaults to NVIDIA NIM's endpoint
 * @param {string} [options.model]       Defaults to a NIM-hosted Llama model
 * @param {string} [options.instructions] Extra freeform instructions appended to the system prompt (e.g. "only extract dining reviews, not delivery")
 * @param {boolean} [options.isHtml=true] Set false if pageContent is already plain text
 * @param {number} [options.maxChars=12000] Truncates pageContent before sending — keeps token usage predictable
 * @param {number} [options.maxTokens=4096]
 *        Completion token budget. Reasoning models can spend a large chunk of
 *        this on chain-of-thought before emitting the actual JSON — too low a
 *        budget silently truncates the response before the JSON array closes,
 *        which surfaces as an empty/partial result, not an error. Found via
 *        real testing (a working extraction intermittently returned 0 items
 *        with no max_tokens set at all, i.e. provider default) — raise this
 *        if you see empty results on a page that should have data.
 * @param {number} [options.timeoutMs=60000]
 * @returns {Promise<any[]>} Parsed JSON, always normalized to an array — a
 *          model returning a single bare object (common for single-entity
 *          pages) is wrapped as a one-item array rather than passed through
 */
async function extractWithLLM(pageContent, schema, options = {}) {
    const {
        apiKey = process.env.NIM_API_KEY,
        baseUrl = DEFAULT_BASE_URL,
        model = DEFAULT_MODEL,
        instructions = '',
        isHtml = true,
        maxChars = 12000,
        maxTokens = 4096,
        timeoutMs = 60000,
    } = options;

    if (!apiKey) {
        throw new Error(
            'No LLM API key supplied. Pass options.apiKey or set the NIM_API_KEY ' +
            'environment variable. Never hardcode a key in source — see README.md.'
        );
    }

    const text = isHtml ? htmlToText(pageContent) : String(pageContent || '');
    const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: buildSystemPrompt(schema, instructions) },
                    { role: 'user', content: truncated },
                ],
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 300)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const parsed = parseJsonFromLLMResponse(content);
        // Despite the system prompt asking for a JSON array, a model can
        // return a single bare object for a single-entity page (e.g.
        // {"title":"..."} instead of [{"title":"..."}]) — every downstream
        // consumer (validateItems, extractWithRetryOnEmpty) assumes an
        // array, and a bare object crashes with "items.map is not a
        // function" rather than a clear error. Normalize here, once, at the
        // boundary, rather than defensively in every caller.
        return Array.isArray(parsed) ? parsed : [parsed];
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    extractWithLLM,
    parseJsonFromLLMResponse,
    buildSystemPrompt,
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
};
