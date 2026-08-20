# Quickstart

## Install

```bash
npm install chiselforge
```

## Run the CLI

```bash
npx chiselforge extract <url> --schema "field1, field2:type, ..."
```

Real example (this is a live, working command — try it):

```bash
npx chiselforge extract \
  "https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews" \
  --schema "name, telephone, servesCuisine" \
  --json-ld-type Restaurant
```

Output:

```
Loading https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews ...
✓ Loaded page
✓ Found structured data (JSON-LD)
✓ Extracted 1 record(s)
✓ Validation passed

{
  "data": [ { "name": "British Brewing Company", "telephone": "+919022885511, +912224933003", "servesCuisine": "British, Burger, Continental, Desserts, European, Pizza, Italian" } ],
  "extraction": { "strategy": "json-ld", "llmUsed": false, "confidence": 0.95, ... }
}
```

No LLM call happened here — the page carries real `Restaurant` JSON-LD, so
tier 1 answered it directly, free and instant.

## Try a case that needs the LLM tier

Remove `--json-ld-type Restaurant` and ask for something the page's JSON-LD
doesn't cover (e.g. individual reviews) and you'll see the pipeline fall
through past JSON-LD to the hydration-state tier, which does use an LLM:

```bash
export NIM_API_KEY="your-key-here"   # see llm-providers.md for provider options

npx chiselforge extract \
  "https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews" \
  --schema "author, text, rating:number" \
  --json-ld-type Review \
  --verbose
```

With `--verbose` you'll see the decision trail (this is real output from an
actual run):

```
  ✓ Fetching https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews
  ✓ Detected hydration state (__PRELOADED_STATE__)
  ✓ JSON-LD found (3 block(s)) but none matched — escalating
  ✓ Extracting via hydration tier
  ✓ Extracted 5 record(s) via hydration tier
  ✓ Validation passed
```

## Schema shorthand

```
"name, price:number, rating:number, reviews:array"
```

Fields without a `:type` default to `string`. Recognized types: `string`,
`number`, `boolean`, `array`, `object`. For anything more precise, use
`--schema-file schema.json`:

```json
{
  "name": "string — product name",
  "price": "number — price in USD",
  "inStock": "boolean"
}
```

(Only the first word of each description is used to infer the type — the
rest is passed to the LLM as a hint, when an LLM tier is used.)

## JS API

```js
const { autoExtract } = require('chiselforge');

const result = await autoExtract(
    'https://example.com/product/123',
    { name: 'string', price: 'number' },
    { apiKey: process.env.NIM_API_KEY }
);

console.log(result.data);
console.log(result.extraction.strategy);   // which tier answered
```

## Crawl a whole site

`extract` handles one page. `crawl` discovers every same-host page from a
seed URL (sitemap.xml first, then a link crawl to fill in the rest) and runs
each one through the same tiered pipeline — checkpointed, and resumable
*if you ask for it*.

```bash
chiselforge crawl https://example.com/ \
  --schema "title, description" \
  --max-pages 30 \
  --output ./crawl-result
```

`--output` controls where results are written — it is **not** the
resumability key. By default, every `crawl` invocation gets its own unique
checkpoint directory (a fresh temp dir), so re-running the same command with
the same `--output` does not skip already-completed pages; it reprocesses
everything and overwrites `--output` with a fresh run. To actually resume a
crawl across separate invocations, pass the same `--checkpoint-dir`
explicitly both times:

```bash
chiselforge crawl https://example.com/ --schema "title, description" \
  --output ./crawl-result --checkpoint-dir ./crawl-result/.checkpoint
# re-run later with the same --checkpoint-dir to resume, not restart
```

See [`architecture.md`](architecture.md)'s crawl section for why this is
opt-in rather than automatic (a real bug — two unrelated invocations
silently sharing state — is exactly why the default isn't a
seed-derived/reused directory).

Writes `crawl-result/index.json` (one line per page: URL, title, which tier
answered, `llmUsed`, confidence, warnings) plus one JSON file per page under
`crawl-result/pages/` containing the full result — schema-shaped structured
data **and** the raw deterministic source text (HTML tags/scripts/styles
stripped, never LLM-paraphrased, captured regardless of which tier fires) so
the corpus isn't solely dependent on how the LLM chose to summarize a page.

No site-specific code — the link discovery (`crawl/discover.js`) works the
same way against any site. See [`architecture.md`](architecture.md) for how
this composes `core/worker-loop.js` (checkpointing/concurrency) with
`autoExtract()` (per-page extraction).

## Next steps

- [`architecture.md`](architecture.md) — how this is built, for extending it
- [`extraction-strategies.md`](extraction-strategies.md) — tier details
- [`llm-providers.md`](llm-providers.md) — using a different LLM provider
