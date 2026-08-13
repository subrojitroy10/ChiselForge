# Architecture

For engineers extending this or deciding whether to build on it.

## Three layers

```
cli.js                          ← Layer 1: zero-config CLI (extract | crawl)
    │
    ├──────────────────────────────────────┐
    ▼                                       ▼
extraction/auto.js               crawl/crawlSite.js  ← Layer 2b: multi-page crawl
autoExtract(url, schema)              │      (composes crawl/discover.js's generic
    — one page in, one         │      link discovery with runWorkerPool + autoExtract
    result out                 │      below — no site-specific code)
    │                          │
    ├── extraction/classify.js      "what kind of page is this"
    ├── extraction/json-ld.js       tier 1 — deterministic
    ├── extraction/llm.js           tier 2/3 — LLM-backed
    ├── extraction/validate.js      schema validation
    └── extraction/confidence.js    heuristic confidence score
    │                          │
    ▼                          ▼
transports/http.js, transports/browser.js    ← how pages are actually fetched
    │                          │
    │                          ▼
    │                    core/worker-loop.js  ← checkpointed, rate-limited,
    │                          │                 retryable multi-job execution
    ▼                          ▼
core/*                          ← Layer 3: engineering API (job queue, checkpoint,
                                   rate limiter, proxy pool, logger, worker pool)
```

`autoExtract` and `crawlSite` are both consumers of the engineering layer,
not a replacement for it. If you're building something that needs to
process thousands of URLs reliably — not just "run this once" — go straight
to `core/worker-loop.js`'s `runWorkerPool` and call `autoExtract` (or your
own extraction logic, or `crawlSite` itself) as the
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

## Multi-page crawling (`crawl/`)

`crawlSite(seed, schema, options)` composes three pieces that each already
existed independently, tied together for the first time by this module:

1. **`crawl/discover.js`** — generic (no site-specific logic) page discovery.
   Tries `sitemap.xml`/`robots.txt` first, then falls back to a same-origin
   BFS crawl of `<a href>` links. Ported from `web-UI/automate.js`, which
   already implemented this generically for a different purpose (frontend
   tech-stack inspection) — direct reuse, not a rewrite.
2. **`core/worker-loop.js`'s `runWorkerPool`** — gives the crawl
   checkpointing (resumable — re-running against the same `checkpointDir`
   skips pages already done), configurable concurrency, and retry, for free.
3. **`extraction/auto.js`'s `autoExtract`** — the actual per-page extraction,
   unchanged. `crawlSite` fetches each page's HTML once and passes it to
   `autoExtract` via `options.html` (added specifically for this — see that
   file's comments) rather than fetching twice.

**Raw text is captured separately from the schema-shaped result, on
purpose.** `htmlToText(html)` runs on every page regardless of which
extraction tier fires — deterministic, never LLM-paraphrased. This means a
crawl's output is never *solely* dependent on how faithfully an LLM
summarized a page into your schema; the raw corpus is there independently.

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

## Language choices

**Runtime: Node.js, staying Node.js.** Playwright's ecosystem, native
`fetch`, npm distribution, and the `npx chiselforge` zero-install
experience all depend on it. Not up for debate.

**JavaScript vs. TypeScript — currently JavaScript, this is a real open
decision, not a settled one.** The decision rule this project uses when
evaluating a new component:

1. Does this belong to browser/runtime/package infrastructure? → Node.js,
   and TypeScript is genuinely justified for public API surfaces (adapter
   interfaces, schema contracts, worker orchestration) — better DX, real
   type safety on contracts other code depends on.
2. Does this involve actual ML/statistical work (see below)? → Python is
   justified there, not here.
3. Is Python being proposed only because "we might need ML eventually"? →
   Don't add it yet — no concrete Python component exists in this repo, and
   none should until there's a specific ML/confidence-modeling task that
   needs it (see Roadmap).
4. Is JavaScript being used here only because that's what the original
   production pipelines happened to be written in? → Partially yes, and
   that's the honest answer, not a justification. The current `.js` files
   were a pragmatic choice to ship a tested, working v0.1 without also
   taking on a full-codebase language migration's regression risk in the
   same pass as the rest of the v0.1 hardening work (CLI, validation,
   confidence scoring, benchmark, docs, licensing). **A converted-to-TypeScript
   version of this codebase is a legitimate, still-open next step** —
   deliberately not done silently in this pass, since a full rewrite of
   ~20 already-tested files carries real regression risk and wasn't itself
   one of the bounded, verifiable changes this hardening pass made. Treat
   this as a tracked decision requiring an explicit choice (full migration
   vs. incremental `.d.ts` type declarations layered on the existing `.js`
   vs. deferring further), not a default either way.

**Python — not present in this repo, and shouldn't be added speculatively.**
There is no ML/statistical component here yet (`extraction/confidence.js` is
a fixed heuristic, explicitly documented as such — see its own file
comments). When the roadmap's "confidence from real outcomes" or "learned
strategy selection" items become concrete work, evaluate Python then, for
that component specifically — not as a wholesale architecture decision made
ahead of any actual need. Do not stand up a Node service + Python service +
message broker + database in anticipation of ML that doesn't exist yet —
that adds real operational complexity for no current user value.

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
