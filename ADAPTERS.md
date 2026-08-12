# Adapters

An adapter is site-specific extraction logic built on top of this engine —
the thing that knows *this particular site's* review-modal selectors, or its
pagination scheme, or which hydration key it uses. This repo intentionally
contains none.

## Current status

- **The interface exists:** [`adapter-interface.md`](adapter-interface.md)
  documents the shape (`resolve` / `paginate` / `extractItems` / `isDone`)
  that a full worker-pool adapter follows, and how the two transports
  (`transports/http.js`, `transports/browser.js`) and pagination-termination
  helpers (`core/pagination.js`) compose into one.
- **No reference adapter implementations ship in this repo, and none are
  planned as a separate public package right now.** This engine was
  generalized out of production scraping pipelines, and those
  production-specific adapters intentionally stay private — they can carry
  operational, compliance, and provenance considerations (site-specific DOM
  assumptions, ToS posture, business logic) that don't belong in a generic,
  public extraction runtime, and publishing them isn't necessary to prove
  the engine works. See [`BENCHMARKS.md`](BENCHMARKS.md) for that proof
  instead — real, reproducible, measured runs of the *generic* engine
  (`autoExtract`, not a site-specific adapter) against real sites.
- **`autoExtract()` is not an adapter.** It's the generic engine
  (`EXTRACTION_STRATEGIES.md`) — it doesn't know about any specific site.
  Reach for a real adapter (built by you, following the interface below)
  when you need reliability against one particular site beyond what the
  generic tiers can guarantee (e.g. you need every page of a paginated
  list, not just what one page's hydration state contains).

## When to write an adapter vs. use `autoExtract()`

| | `autoExtract()` | A real adapter |
|---|---|---|
| Setup cost | Zero — just a schema | Selectors/pagination logic per site |
| Reliability on one specific site | Best-effort across 3 tiers | As reliable as you make it |
| Pagination across many pages | Not handled — one page in, one result out | `core/pagination.js` + `core/worker-loop.js` |
| Runs at scale (thousands of jobs, resumable) | Not by itself | Yes — via `runWorkerPool` |
| Maintenance burden | None (generic) | Breaks when the site's markup changes |

Use `autoExtract()` for exploration, one-off pulls, or when you don't know
the site ahead of time. Write a real adapter when you're running the same
target repeatedly and need the reliability/scale/resumability that
`core/worker-loop.js` provides.

## Building one

1. Read [`adapter-interface.md`](adapter-interface.md) for the shape.
2. Pick a transport: `transports/http.js` if the site serves full content
   via a plain GET (check with `extraction/classify.js`'s `needsBrowser`
   flag first — don't assume you need a browser), `transports/browser.js`
   otherwise.
3. Write your `processJob(job, ctx)` function — this is what
   `runWorkerPool()` calls once per job. Compose it from the pieces above:
   fetch/render, extract (your own selectors, or reuse
   `extraction/json-ld.js`/`extraction/llm.js` as building blocks), decide
   when to stop paginating (`core/pagination.js`).
4. Wire it into `runWorkerPool()` (`core/worker-loop.js`) for queueing,
   checkpointing, and retry.

No production-derived example ships with this repo (see "Current status"
above for why). A clean, from-scratch example adapter — written against a
stable public site with no production code or private logic behind it — is
a reasonable future addition here; until one exists, `adapter-interface.md`
plus the table above is the available guidance for building your own.
