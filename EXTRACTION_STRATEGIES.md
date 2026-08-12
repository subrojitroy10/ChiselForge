# Extraction strategies

Three tiers, tried cheapest/most-deterministic first. `autoExtract` stops at
the first tier that produces relevant data.

## Tier 1 — JSON-LD (`extraction/json-ld.js`)

Many sites embed `<script type="application/ld+json">` blocks — structured
data in the [schema.org](https://schema.org) vocabulary, put there
specifically so crawlers (originally search engines, now also tools like
this one) don't need custom selectors. When present and relevant, this is
free, instant, and exact — no LLM involved at all.

**The catch, found during real testing:** a page can carry real JSON-LD for
something *else* entirely. A restaurant page might have `Restaurant`,
`WebSite`, and `BreadcrumbList` blocks but no `Review` block — "JSON-LD is
present" is not the same as "JSON-LD answers what you asked for." Pass
`jsonLdType` (e.g. `'Review'`, `'Product'`) so tier 1 only short-circuits
when a block actually matches:

```js
autoExtract(url, schema, { jsonLdType: 'Review' })
```

Without `jsonLdType`, tier 1 falls back to a field-overlap heuristic
(`findRelevantBlocks`) rather than accepting any JSON-LD present: it checks
whether a block's own keys plausibly match your schema's field names, and
returns only the single best-matching block (or blocks tied for best) —
never "everything above a loose floor," since that let a schema sharing just
one common field name (e.g. `name`) with an unrelated `WebSite` block get
accepted incorrectly, found via testing. This is a heuristic, not an exact
match — `jsonLdType` is always more precise when you know it.

## Tier 2 — Hydration state (`extraction/classify.js` + `extraction/llm.js`)

Many modern sites (React/Vue/Next.js apps with server-side rendering) embed
their entire initial application state as JSON in the page, under a
predictable global — `window.__PRELOADED_STATE__`, `window.__NUXT__`,
`window.__APOLLO_STATE__`, or Next.js's dedicated
`<script id="__NEXT_DATA__">` convention. `classify.js` detects these
directly from the raw HTML response — no browser needed, since this state is
typically present in the server-rendered HTML before any client JS runs.

When found, the *entire* state object is handed to the LLM as structured
JSON context (not raw HTML) and asked to extract items matching your schema.
This is meaningfully more reliable than tier 3 because the LLM is reading
clean, already-structured data instead of parsing markup noise.

**Known failure mode, found during real testing, not hypothetical:** these
state objects are often large and deeply nested — a whole app's initial
state, not just the section you asked about (dozens of unrelated top-level
keys: page metadata, ad config, feature flags, and somewhere several levels
deep, the data you actually want). Without guidance, an LLM can report "no
matching items" even when the data is present and well within the
truncation window. `auto.js` addresses this with a generic (not
site-specific) instruction telling the model to search nested structure
before concluding nothing matches — this measurably fixed the failure in
testing, using no site-specific hints. A bounded single retry
(`extractWithRetryOnEmpty`) also guards against an otherwise-correct
extraction occasionally coming back as a clean, valid empty array at
temperature 0 (observed directly — `finish_reason: "stop"`, not a
truncation error).

Default budget: 60,000 characters of state JSON, up to 8,192 completion
tokens, 120s timeout — tunable via `hydrationMaxChars`, `llmMaxTokens`,
`llmTimeoutMs`.

## Tier 3 — Raw text (`extraction/llm.js`)

No JSON-LD, no recognized hydration format — the last resort. The page's
visible text (`extraction/html-to-text.js` strips scripts/styles/tags) is
handed to the LLM cold, with your schema as the target shape.

**Be honest about this tier specifically:** it's where "extract anything
from any website" claims stop being fully reliable. There's no structure to
lean on — the LLM has to both find and format the data from scratch. Use it,
but don't build anything that assumes it's as dependable as tiers 1-2. See
[`BENCHMARKS.md`](BENCHMARKS.md) for measured tier-selection rates, not
estimates.

## Rendering classification (`extraction/classify.js`)

Before any tier runs, `classifyHtml()` decides whether a browser is even
needed — a heuristic check for an empty SPA shell (very little visible text
plus a bare `#root`/`#app`/`#__next` mount point with nothing inside).
`autoExtract` does not launch a browser itself; if `needsBrowser` comes back
true, it throws unless you supplied `options.renderWithBrowser`. See
`ARCHITECTURE.md`'s "Why no built-in browser fallback."

## Adding a new hydration-state format

`classify.js`'s `KNOWN_HYDRATION_GLOBALS` list is not exhaustive. If you hit
a framework convention not covered (something other than
`__PRELOADED_STATE__`, `__NUXT__`, `__APOLLO_STATE__`, `__INITIAL_STATE__`,
`__REDUX_STATE__`, or Next.js's `__NEXT_DATA__`), add the global name to
that list — `extractWindowGlobal()` already handles both the escaped
(`JSON.parse("...")`) and direct object-literal assignment shapes.
