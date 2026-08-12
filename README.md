# scraper-harness

**Extract structured data from webpages without writing a scraper.**

```bash
npx scraper-harness extract https://example.com/product/123 \
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
not a mockup. See [`QUICKSTART.md`](QUICKSTART.md) for the exact command.

It starts with structured data already exposed by the page and only uses an
LLM when deterministic extraction alone isn't sufficient. You can see and
control exactly which tier ran — `extraction.strategy` and
`extraction.llmUsed` are in every result, and `--verbose` prints the decision
trail as it happens.

## The core idea

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
reliable than tier 3's raw text — see `EXTRACTION_STRATEGIES.md` and
`BENCHMARKS.md`'s measured latency difference — but "more reliable than
tier 3" is not the same as "deterministic"). `extraction.llmUsed` in every
result tells you plainly whether an LLM was involved, rather than leaving it
implied. See [`EXTRACTION_STRATEGIES.md`](EXTRACTION_STRATEGIES.md) for the
specifics, and [`BENCHMARKS.md`](BENCHMARKS.md) for measured numbers on how
often each tier actually fires — not marketing estimates.

## Install

```bash
npm install scraper-harness
```

`playwright` and `undici` are optional — only needed for browser-rendered
pages or HTTP proxy support, respectively. The JSON-LD tier and the CLI's
common case need neither.

## Three ways to use this

### 1. CLI (fastest way to try it)

```bash
scraper-harness extract <url> --schema "field, field:type, ..."
scraper-harness extract <url> --schema-file schema.json --output result.json
scraper-harness extract <url> --verbose   # show every decision the pipeline made
```

Full options in [`QUICKSTART.md`](QUICKSTART.md).

### 2. JS/TS API

```js
const { autoExtract } = require('scraper-harness');

const result = await autoExtract(url, {
    name: 'string',
    price: 'number',
    rating: 'number',
    reviews: 'array',
}, {
    apiKey: process.env.NIM_API_KEY,   // only used if a tier needs an LLM
    jsonLdType: 'Product',              // optional — see EXTRACTION_STRATEGIES.md
});

result.data;                    // extracted items
result.extraction.strategy;     // 'json-ld' | 'hydration' | 'text'
result.extraction.llmUsed;      // boolean
result.extraction.confidence;   // 0-1 heuristic, see ARCHITECTURE.md
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
- Site-specific adapters (in the sibling `scraper-adapters` package)
- Schema validation and normalized output
- Provider-agnostic LLM integration
- Structured extraction logging

Use the high-level API when you just need data. Compose the underlying
primitives directly when building a larger scraping or browser-automation
system — this infrastructure was generalized from production pipelines that
had already handled real scraping workloads (10 concurrent workers across
~11,000 venues with zero blocks; a separate HTTP-based pipeline across 634
venues with proxy rotation) before this repo existed. See
[`ARCHITECTURE.md`](ARCHITECTURE.md).

```js
const { runWorkerPool, RateLimiter, ProxyPool, JobQueue } = require('scraper-harness');
```

`autoExtract()` is the front door. This is the building.

## Real adapters, not just a generic engine

Google Search/Maps, MagicPin, and Zomato adapters (built on this same
engine, proven at production scale — see
[`ADAPTERS.md`](ADAPTERS.md)) live in the sibling `scraper-adapters`
package. This repo is the generic engine; that one is proof it holds up
against real, difficult, dynamic sites — not just the happy path.

## Docs

- [`QUICKSTART.md`](QUICKSTART.md) — install to first result in under 5 minutes
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the pieces fit together, for engineers extending this
- [`EXTRACTION_STRATEGIES.md`](EXTRACTION_STRATEGIES.md) — how each tier works and when it's chosen
- [`ADAPTERS.md`](ADAPTERS.md) — building a site-specific adapter on top of this engine
- [`LLM.md`](LLM.md) — configuring the LLM tier, provider-agnostic setup
- [`BENCHMARKS.md`](BENCHMARKS.md) — measured tier/success/latency numbers, not estimates
- [`CONTRIBUTING.md`](CONTRIBUTING.md)

## What this is not

Not a hosted service, not a SaaS, no billing, no accounts, no dashboard. It's
a local/self-hostable library and CLI, and it doesn't try to define itself
against other tools — it stands on its own thesis: deterministic extraction
first, an LLM only when necessary, and production-derived infrastructure
underneath rather than a thin demo layer.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
