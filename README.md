# ChiselForge

**Web extraction that knows when not to use an LLM.**

URL + schema → validated structured data. Extract structured data from
webpages without writing a scraper.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

```bash
npx chiselforge extract https://example.com/product/123 \
  --schema "name, price:number, rating:number"
```

```
Loading https://example.com/product/123 ...
✓ Loaded page
✓ Found structured data (JSON-LD)
✓ Extracted 1 record(s)
✓ Validation passed

{
  "data": [ { "name": "...", "price": 42.0, "rating": 4.5 } ],
  "extraction": { "strategy": "json-ld", "llmUsed": false, "confidence": 0.95, ... }
}
```

That output above is real — captured from an actual run against a live page,
not a mockup. See [`docs/quickstart.md`](docs/quickstart.md) for the exact command.

## In plain terms

You give it a link and describe what you want in a sentence or two. It
figures out the cheapest way to actually get that data — reading structured
data the page already exposes when it can, asking an AI model to read the
page when it has to — and hands you back clean JSON. You don't write
selectors, you don't learn a scraping library, and you don't pay for an AI
call on pages that didn't need one.

## For engineers

It starts with structured data already exposed by the page and only uses an
LLM when deterministic extraction alone isn't sufficient. You can see and
control exactly which tier ran — `extraction.strategy` and
`extraction.llmUsed` are in every result, and `--verbose` prints the decision
trail as it happens. Nothing about this decision is hidden from you if you
want to see it — see "Three ways to use this" below for the full range from
zero-config CLI down to the raw engine primitives.

### The core idea

> Use the cheapest, most deterministic extraction method that can reliably
> answer the request, and only escalate when necessary.

```
URL + schema
    ↓
Rendering classification        (does this page even need a browser?)
    ↓
Tier 1 — JSON-LD / schema.org    (deterministic — free, instant, exact, if present and relevant)
    ↓
Tier 2 — hydration-state         (structured app state — an LLM maps it to your schema)
    ↓
Tier 3 — raw text                (last resort — no structure found at all, LLM interprets cold)
    ↓
Schema validation
    ↓
Structured output
```

This is not "another Playwright wrapper" and not "another LLM scraper."
LLM-first extraction is convenient, but can be unnecessarily expensive and
slow when the page already exposes structured data — this project tries the
deterministic path first and tells you when it had to escalate.

**Be precise about which tiers are actually deterministic.** Only tier 1
(JSON-LD) is deterministic — no LLM involved, same input always produces the
same output. Tiers 2 and 3 both use an LLM to map data onto your schema
(tier 2 gets clean structured JSON as input, which is meaningfully more
reliable than tier 3's raw text — see `docs/extraction-strategies.md` and
`docs/benchmarks.md`'s measured latency difference — but "more reliable than
tier 3" is not the same as "deterministic"). `extraction.llmUsed` in every
result tells you plainly whether an LLM was involved, rather than leaving it
implied. See [`docs/extraction-strategies.md`](docs/extraction-strategies.md) for the
specifics, and [`docs/benchmarks.md`](docs/benchmarks.md) for measured numbers on how
often each tier actually fires — not marketing estimates.

## Why ChiselForge?

Most extraction tools start with an LLM by default — convenient, but slower
and more expensive than necessary on the large share of pages that already
expose the data you want in a structured form. ChiselForge tries the
cheapest deterministic mechanism first and escalates only when the page
actually requires it (see "The core idea" above for the exact tier order).

That ordering buys you:

- **lower latency when structured data exists** — the JSON-LD tier is a
  local parse, not a model call (~918ms vs. ~32s for an LLM-backed tier in
  one measured run — see [`docs/benchmarks.md`](docs/benchmarks.md))
- **lower cost** — no LLM API call at all when a deterministic tier answers
  the schema
- **better reproducibility** — the deterministic tier's output doesn't vary
  run to run; the LLM tiers are used only when there's no alternative
- **easier debugging** — `extraction.strategy` and `--verbose` show exactly
  which tier ran and why, instead of an opaque single "AI extraction" step
- **clearer provenance** — every result reports whether an LLM or a browser
  was actually used (`extraction.llmUsed`, `extraction.browserUsed`), not
  just what the tool is capable of in general
- **a smaller hallucination surface** — the deterministic tier can't invent
  data; LLM involvement is opt-in-by-necessity, not the default path
- **honest failure over fabricated completeness** — when a schema asks for
  data a page genuinely doesn't have, the correct result is zero items, not
  a plausible-looking guess (see "the honest-failure case" in
  [`docs/benchmarks.md`](docs/benchmarks.md))

None of this means "always faster" (every extraction still costs at least
one page fetch) or "zero hallucinations" (tiers 2 and 3 are LLM-backed and
inherit LLM failure modes) — see
[`docs/benchmarks.md`](docs/benchmarks.md) for what's actually measured, not
estimated.

## Install

```bash
npm install chiselforge
```

That installs the core extraction engine only — `playwright` (browser
rendering) and `undici` (HTTP proxy support) are **not** installed by
default. Neither the JSON-LD tier nor the CLI's common case needs them, and
both are required lazily inside the code paths that do (only `require()`'d
when a call actually needs them), so a call that doesn't use browser
rendering or a proxy never pays for either. If you need one:

```bash
npm install playwright && npx playwright install chromium   # browser rendering
npm install undici                                          # HTTP proxy support
```

Skipping one you do need doesn't fail silently — the relevant call throws a
clear "install X to use this" error naming exactly what to run (see
`transports/browser.js`/`transports/http.js`). Both are Apache-2.0/MIT
licensed — compatible with this project's Apache-2.0 license, verified via
each package's own `package.json`. (If you're working in this repo itself
rather than depending on it, `npm install` already pulls both in as
`devDependencies` — they're needed to run `benchmark/` and aren't shipped in
the published package.)

## For AI agents and coding tools

`autoExtract(url, schema)` is a single, self-contained call with a JSON-in,
JSON-out shape — no session state, no multi-step setup — which makes it
straightforward for an agent (Claude, Cursor, Codex, etc.) to call as a
tool: "extract all the products from this page" maps directly onto one
function call with a schema, and gets back validated structured data plus a
plain record of how it got there (`extraction.strategy`, `llmUsed`,
`confidence`). There's no MCP server shipping yet — that's a natural future
wrapper around this same call, not a redesign — but the API is already
shaped for it today, via the CLI or the JS function directly.

## Three ways to use this

### 1. CLI (fastest way to try it)

```bash
chiselforge extract <url> --schema "field, field:type, ..."
chiselforge extract <url> --schema-file schema.json --output result.json
chiselforge extract <url> --verbose   # show every decision the pipeline made

chiselforge crawl <seed-url> --schema "..." --max-pages 30 --output ./result
```

`crawl` discovers every same-host page from a seed URL and runs each one
through the same tiered pipeline — checkpointed, resumable, no site-specific
code. Full options in [`docs/quickstart.md`](docs/quickstart.md).

### 2. JS/TS API

```js
const { autoExtract } = require('chiselforge');

const result = await autoExtract(url, {
    name: 'string',
    price: 'number',
    rating: 'number',
    reviews: 'array',
}, {
    apiKey: process.env.NIM_API_KEY,   // only used if a tier needs an LLM
    jsonLdType: 'Product',              // optional — see docs/extraction-strategies.md
});

result.data;                    // extracted items
result.extraction.strategy;     // 'json-ld' | 'hydration' | 'text'
result.extraction.llmUsed;      // boolean
result.extraction.browserUsed;  // boolean — was a browser actually rendered for this call?
result.extraction.confidence;   // 0-1 heuristic, see docs/architecture.md
```

### 3. Engineering API — the infrastructure underneath

`autoExtract()` is the high-level interface. It's built on a modular browser
and extraction runtime that can also be used directly. The underlying
infrastructure provides:

- Multi-worker browser execution
- Job queues with resumable checkpointing
- Browser/context lifecycle management, context recycling, restart policies
- Retry and timeout controls
- Rate limiting and proxy pools
- Stagnation-aware lazy-load/infinite-scroll extraction
- Pluggable extraction strategies
- A public adapter interface for site-specific extraction logic (see `docs/adapters.md` — production implementations of it are intentionally not published here, see "Real-world validation" below)
- Schema validation and normalized output
- Provider-agnostic LLM integration
- Structured extraction logging
- Generic same-host site crawling (`crawlSite` / `discoverPages`) — sitemap + link discovery composed with the worker pool above, no site-specific code

Use the high-level API when you just need data. Compose the underlying
primitives directly when building a larger scraping or browser-automation
system — this infrastructure was generalized from earlier data-collection
pipelines, not written from scratch for this repo (see "Built from real
infrastructure" below). See [`docs/architecture.md`](docs/architecture.md).

```js
const { runWorkerPool, RateLimiter, ProxyPool, JobQueue, crawlSite } = require('chiselforge');
```

`autoExtract()` is the front door. This is the building.

## Built from real infrastructure

ChiselForge was generalized from data-collection infrastructure originally
developed for real-world research and data workloads at Polynovea. Earlier
pipelines underlying this project operated across datasets involving
approximately 11,000 venue records.

That's the origin of the worker pool, checkpointing, rate limiting, and
proxy rotation you'll find under `core/`. It is not a claim that *this
public, generalized codebase* — as published in this repository — has
itself processed that dataset in production. What this codebase's own
correctness rests on is the benchmark below: real, reproducible runs of the
actual public engine, not the private pipelines it was drawn from.

## Real-world validation

The extraction engine has been validated against real-world dynamic
websites during development, including pages using structured data,
hydration state, and content requiring browser rendering — see
[`docs/benchmarks.md`](docs/benchmarks.md) for the measured, reproducible results.

Production-specific adapters and datasets are intentionally not included in
this public repository. Site-specific adapters can carry operational,
compliance, and provenance considerations that don't belong in a generic
extraction runtime, and publishing them isn't necessary to prove the engine
works — the benchmark does that on its own, with real numbers. This repo
focuses on the reusable browser and extraction infrastructure; see
[`docs/adapters.md`](docs/adapters.md) for the adapter interface itself, which is
public and meant to be built on, even though specific production
implementations of it aren't shipped here.

## Docs

- [`examples/`](examples/) — runnable scripts for every public API entry point
- [`docs/quickstart.md`](docs/quickstart.md) — install to first result in under 5 minutes
- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit together, for engineers extending this
- [`docs/extraction-strategies.md`](docs/extraction-strategies.md) — how each tier works and when it's chosen
- [`docs/adapters.md`](docs/adapters.md) — building a site-specific adapter on top of this engine
- [`docs/llm-providers.md`](docs/llm-providers.md) — configuring the LLM tier, provider-agnostic setup
- [`docs/benchmarks.md`](docs/benchmarks.md) — measured tier/success/latency numbers, not estimates
- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`CHANGELOG.md`](CHANGELOG.md)
- [`SECURITY.md`](SECURITY.md)
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

## What this is not

Not a hosted service, not a SaaS, no billing, no accounts, no dashboard. It's
a local/self-hostable library and CLI, and it doesn't try to define itself
against other tools — it stands on its own thesis: deterministic extraction
first, an LLM only when necessary, and production-derived infrastructure
underneath rather than a thin demo layer.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
