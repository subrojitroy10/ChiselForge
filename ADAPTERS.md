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
- **Reference implementations are not in this repo.** Google Search/Maps,
  MagicPin, and Zomato adapters — each proven against real, difficult,
  dynamic sites at production scale — live in the sibling `scraper-adapters`
  package, which depends on this one. See that repo's README for what each
  one demonstrates and its current build/test status.
- **`autoExtract()` is not an adapter.** It's the generic engine
  (`EXTRACTION_STRATEGIES.md`) — it doesn't know about any specific site.
  Reach for a real adapter when you need reliability against one particular
  site beyond what the generic tiers can guarantee (e.g. you need every
  page of a paginated review list, not just what one page's hydration state
  contains).

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

See `scraper-adapters`' Zomato adapter for a concrete example: HTTP
transport only, hydration-state extraction (no LLM needed there — the exact
field path is known ahead of time, unlike `autoExtract`'s generic case),
`reviewId`-based dedup via `core/pagination.js`'s `DedupTracker`.
