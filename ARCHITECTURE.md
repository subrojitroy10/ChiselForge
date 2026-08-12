# Architecture

For engineers extending this or deciding whether to build on it.

## Two layers

```
cli.js                          ← Layer 1: zero-config CLI
    │
    ▼
extraction/auto.js              ← Layer 2: autoExtract(url, schema) — composed pipeline
    │
    ├── extraction/classify.js      "what kind of page is this"
    ├── extraction/json-ld.js       tier 1 — deterministic
    ├── extraction/llm.js           tier 2/3 — LLM-backed
    ├── extraction/validate.js      schema validation
    └── extraction/confidence.js    heuristic confidence score
    │
    ▼
transports/http.js, transports/browser.js    ← how pages are actually fetched
    │
    ▼
core/*                          ← Layer 3: engineering API (job queue, checkpoint,
                                   rate limiter, proxy pool, logger, worker pool)
```

`autoExtract` is a consumer of the engineering layer, not a replacement for
it. If you're building something that needs to process thousands of URLs
reliably — not just "run this once" — go straight to `core/worker-loop.js`'s
`runWorkerPool` and call `autoExtract` (or your own extraction logic) as the
per-job function.

## The extraction pipeline, in order

1. **`fetchHtml(url)`** (`transports/http.js`) — plain HTTP GET, no browser.
2. **`classifyHtml(html)`** (`extraction/classify.js`) — pure function, no
   network. Decides: does this need a browser? Is there JSON-LD? Is there a
   known hydration-state global? See `EXTRACTION_STRATEGIES.md`.
3. If `needsBrowser`, the caller-supplied `renderWithBrowser(url)` runs and
   the page is reclassified against the rendered HTML. `autoExtract` does
   not launch a browser itself — see "Why no built-in browser fallback"
   below.
4. **Tier attempts, cheapest first** — JSON-LD → hydration-state+LLM →
   raw-text+LLM. Each tier either returns or falls through; the first one
   that produces relevant data wins.
5. **`validateItems(items, schema)`** (`extraction/validate.js`) — checks
   field presence and rough type match against the schema.
6. **`estimateConfidence(tier, validation)`** (`extraction/confidence.js`) —
   a fixed heuristic (see the file's own comments), not a trained model.

## Why no built-in browser fallback

`autoExtract` takes an optional `renderWithBrowser` callback instead of
importing Playwright and launching a browser itself. Two reasons:

1. **Dependency weight.** Most extraction (JSON-LD, hydration-state) never
   needs a browser at all. Making Playwright a hard dependency of the whole
   package would tax every user for a capability most calls don't use.
2. **Separation of concerns.** `transports/browser.js` already has two
   browser modes (`BrowserRuntime` for worker-pool jobs, `connectToLocalChrome`
   for interactive/search flows) — `autoExtract` shouldn't hardcode a
   preference between them. The caller picks.

## Why interfaces are minimal, not abstract classes

The brief that shaped this v0.1 asked for clean interfaces
(`PageClassifier`, `StrategySelector`, `Extractor`, `Validator`,
`ConfidenceEstimator`) without pretending the project has ML-driven strategy
selection yet. What exists today:

- `classifyHtml()` — a plain function, not a `PageClassifier` class. There's
  exactly one classification strategy right now; a class hierarchy for one
  implementation would be premature abstraction.
- Strategy *selection* is a fixed if/else chain in `auto.js`, not a
  pluggable `StrategySelector`. It's simple enough to read in one pass.
- `extractWithLLM()`, `extractJsonLdBlocks()` — functions, not an
  `Extractor` interface, for the same reason.
- `validateItems()` / `estimateConfidence()` — the two places closest to
  deserving a real interface, since the roadmap (see below) is to make both
  smarter over time without changing their call sites.

If a second classification strategy, a second confidence model, or
adapter-specific validation shows up, that's when these become real
interfaces — not before.

## Roadmap (not built yet — don't assume any of this exists)

The long-term direction, in order of how far off each is:

1. **Confidence estimation from real outcomes.** Right now `confidence.js`
   is a fixed lookup table. A real version would track validation
   pass/fail rates per-tier, per-domain over time.
2. **Learned strategy selection.** Right now the tier order is fixed
   (JSON-LD → hydration → text). A learned version would use past success
   rates to skip tiers unlikely to work for a given site shape.
3. **MCP server interface.** So an AI coding agent can call
   `extract_url(url, schema)` as a tool directly. Not built for v0.1 — the
   underlying API (`autoExtract`) is already shaped to make this a thin
   wrapper when it happens, not a redesign.

None of these are v0.1 scope. Building them now, ungrounded in real usage
data, would be pretending sophistication this project doesn't have.

## Related docs

- [`EXTRACTION_STRATEGIES.md`](EXTRACTION_STRATEGIES.md) — tier mechanics
- [`ADAPTERS.md`](ADAPTERS.md) — building site-specific logic on top of this
- [`LLM.md`](LLM.md) — the LLM tier's provider setup
