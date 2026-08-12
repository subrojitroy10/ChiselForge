# Benchmarks

**These are the only numbers in this document that have actually been
measured.** Everything below comes from `benchmark/results.json`, generated
by `benchmark/run.js`. No estimated or extrapolated figures — if you see a
number here, it was produced by a real run against a live page (and, for the
LLM-tier cases, a real NIM API call).

Last measured: 2026-08-12T23:16Z, model `nvidia/llama-3.3-nemotron-super-49b-v1`.
Re-run after the tier-1 relevance heuristic change (`findRelevantBlocks`,
`extraction/json-ld.js`) — numbers below reflect current behavior, not a
stale prior run.

## Results

| Case | Tier used | LLM used | Items | Confidence | Latency | Result |
|---|---|---|---|---|---|---|
| Zomato reviews (asked for `Review` schema) | `hydration` | yes | 5 | 0.75 | 39,153ms | ✅ pass |
| Zomato restaurant metadata (asked for `Restaurant` schema, `jsonLdType` hint given) | `json-ld` | no | 1 | 0.95 | 857ms | ✅ pass |
| example.com (no structure at all) | `text` | yes | 1 | 0.50 | 1,985ms | ✅ pass |

**3/3 passed.** 1 of 3 avoided the LLM entirely (the JSON-LD case, correctly
short-circuited by tier 1). 2 of 3 needed an LLM call.

**JSON-LD tier is ~45x faster than the LLM-backed hydration tier** in this
run (857ms vs 39,153ms) — the concrete cost of escalating past tier 1 when
it doesn't apply.

**Separately verified (not part of this automated corpus, but real, live
runs — see conversation record):** both the restaurant-metadata and reviews
cases above were re-run *without* the `jsonLdType` hint, relying only on the
field-overlap heuristic added to tier 1. Both produced the same correct
result — the heuristic picked the Restaurant block for the metadata schema
and correctly rejected all 3 JSON-LD blocks (including on a first attempt
that revealed a real false-positive bug, since fixed) for the reviews
schema, falling through to the hydration tier as it should.

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

## Three real bugs found and fixed via real testing

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
3. **The tier-1 relevance heuristic had a false-positive on small schemas.**
   Added to make JSON-LD relevance checking automatic (not just via the
   explicit `jsonLdType` hint) — the first version accepted any block
   scoring above a fixed overlap floor, which meant a 2-field schema sharing
   just one common field name (e.g. `name`) with an unrelated `WebSite`
   block got wrongly accepted alongside the actually-relevant block. Fixed
   by returning only the single best-scoring block(s), not everything above
   the floor — caught by a committed test
   (`test/json-ld.test.js`), not a live run, before it could reach
   production behavior.

All three fixes are now part of the default behavior, not something you
need to configure.

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
