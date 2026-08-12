# Benchmarks

**These are the only numbers in this document that have actually been
measured.** Everything below comes from `benchmark/results.json`, generated
by `benchmark/run.js`. No estimated or extrapolated figures — if you see a
number here, it was produced by a real run against a live page (and, for the
LLM-tier cases, a real NIM API call).

Last measured: 2026-08-12, model `nvidia/llama-3.3-nemotron-super-49b-v1`.

## Results

| Case | Tier used | LLM used | Items | Confidence | Latency | Result |
|---|---|---|---|---|---|---|
| Zomato reviews (asked for `Review` schema) | `hydration` | yes | 5 | 0.75 | 42,996ms | ✅ pass |
| Zomato restaurant metadata (asked for `Restaurant` schema, `jsonLdType` hint given) | `json-ld` | no | 1 | 0.95 | 1,085ms | ✅ pass |
| example.com (no structure at all) | `text` | yes | 1 | 0.50 | 1,322ms | ✅ pass |

**3/3 passed.** 1 of 3 avoided the LLM entirely (the JSON-LD case, correctly
short-circuited by tier 1). 2 of 3 needed an LLM call.

**JSON-LD tier is ~40x faster than the LLM-backed hydration tier** in this
run (1,085ms vs 42,996ms) — the concrete cost of escalating past tier 1 when
it doesn't apply.

## Known gaps — read before trusting this as representative

This is a **starter corpus of 3 cases**, not the diverse benchmark this
project should eventually have. It does not yet cover, and no claim is made
about:

- Next.js `__NEXT_DATA__` hydration on a real live site (only tested via a
  synthetic fixture in `test/classify.test.js` — see `EXTRACTION_STRATEGIES.md`)
- A page that genuinely requires a browser (`needsBrowser: true` +
  `renderWithBrowser`) — not exercised in this benchmark at all
- E-commerce product pages, article/news pages, infinite-scroll pages
- Google Maps (covered by `scraper-adapters`, not this generic pipeline)
- Any page where the correct answer is a large number of items (this corpus
  tops out at 5)

**Do not repeat unqualified claims like "X% of pages skip the LLM" from
this data** — 3 samples is not a statistically meaningful corpus. The
honest claim this data supports is narrower: *"in this starter corpus, the
tier-1 JSON-LD shortcut worked correctly when relevant data was present, and
was dramatically faster than the LLM-backed tiers when it did."*

## Two real bugs this benchmark run caught and fixed

Not hypothetical concerns — both found by running real cases and looking at
what actually came back:

1. **Deeply nested hydration state silently missed present data.** The
   Zomato hydration case initially returned 0 items despite the correct data
   being confirmed present in the state object — the model needed an
   explicit instruction to search nested structure rather than assume
   relevant data lives near the top level. Fixed generically in
   `extraction/auto.js` (not a Zomato-specific hint) — see
   `EXTRACTION_STRATEGIES.md`.
2. **Single-entity pages returned an empty array.** The example.com case
   initially failed because the system prompt implicitly framed extraction
   as "find repeated similar items," and a page describing exactly one thing
   doesn't read as a list. Fixed in `extraction/llm.js`'s default system
   prompt — verified the fix works with no caller-supplied instructions, not
   just when explicitly told to via `instructions`.

Both fixes are now part of the default behavior, not something you need to
configure.

## Running this yourself

```bash
NIM_API_KEY=your-key node benchmark/run.js
```

Not part of `npm test` — costs real time and API usage, and depends on
external pages staying up. See `CONTRIBUTING.md` for why live-site tests are
kept separate from the committed fixture-based test suite.

## Expanding this corpus

`benchmark/corpus.js` is a plain array — add a case with `{ name, url,
schema, options, expectMinItems }` and re-run. Contributions that add real,
diverse, verified cases (especially the gaps listed above) are the single
most useful thing this project could receive right now — see the strategic
note in the project's planning docs: benchmark credibility matters more at
this stage than additional features.
