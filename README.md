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

It starts with **deterministic extraction** (structured data already on the
page) and only escalates to an LLM when the page genuinely doesn't have
structured data to read. You can see and control exactly which tier ran —
`extraction.strategy` and `extraction.llmUsed` are in every result, and
`--verbose` prints the decision trail as it happens.

## The core idea

> Use the cheapest, most deterministic extraction method that can reliably
> answer the request, and only escalate when necessary.

```
URL + schema
    ↓
Rendering classification        (does this page even need a browser?)
    ↓
Tier 1 — JSON-LD / schema.org    (free, instant, exact — if present and relevant)
    ↓
Tier 2 — hydration-state         (structured app state, LLM maps it to your schema)
    ↓
Tier 3 — raw text                (last resort — no structure found at all)
    ↓
Schema validation
    ↓
Structured output
```

This is not "another Playwright wrapper" and not "another LLM scraper." Most
tools reach for an LLM by default because it's the easy path; this one tries
hard not to, and tells you when it had to.

**Honest limitation:** tiers 1 and 2 are deterministic and reliable. Tier 3
(no JSON-LD, no recognized hydration format) is a genuine last resort —
non-deterministic, and the point where "extract anything" claims stop being
fully honest. See [`EXTRACTION_STRATEGIES.md`](EXTRACTION_STRATEGIES.md) for
the specifics, and [`BENCHMARKS.md`](BENCHMARKS.md) for measured numbers on
how often each tier actually fires — not marketing estimates.

## Install

```bash
npm install scraper-harness
```

`playwright` and `undici` are optional — only needed for browser-rendered
pages or HTTP proxy support, respectively. The deterministic tiers and the
CLI's common case need neither.

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

### 3. Engineering API — the pieces underneath

Everything `autoExtract` composes is independently usable: a resumable
multi-worker job queue, checkpointing, rate limiting, proxy rotation,
structured logging, browser lifecycle management (fresh-launch pool with
recycling, or CDP-attach to a real local Chrome), and each extraction tier on
its own. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

```js
const { runWorkerPool, RateLimiter, ProxyPool, JobQueue } = require('scraper-harness');
```

This is the layer a serious scraping project builds on — not something a
`autoExtract()` call hides forever, just something you don't need on day one.

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
a local/self-hostable library and CLI. It doesn't try to out-market Apify,
out-feature Crawlee, or out-scale Firecrawl — it exists because "don't call
an LLM unless you actually have to" was worth building properly, and because
the infrastructure underneath it (worker pools, checkpointing, browser
lifecycle management) was already proven at real production scale before
this repo existed.

## License

MIT — see [`LICENSE`](LICENSE).
