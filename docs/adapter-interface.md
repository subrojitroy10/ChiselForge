# Adapter interface

ChiselForge's engine (queue, checkpoint, rate limiter, proxy pool, logger,
worker loop, both transports) has no knowledge of any specific website. An
adapter is the piece that does. No production-derived reference adapters
ship in this repo, and none are planned as a separate public package — see
`adapters.md` for why. This document is the interface itself, meant to be
built on even though specific implementations of it aren't published here.

There is no enforced base class or TypeScript interface yet (v0.1 is
JavaScript, and the interface below is a convention, not a runtime
contract).

## The shape

```
resolve(input) -> url          // optional: turn a name/query into a target URL.
                                // Skipped entirely for direct-URL input.

paginate(url, context)         // walks pages/scrolls for one job, yields raw
  -> AsyncIterable<PageResult>    page results (HTML string, or DOM handle,
                                   depending on transport)

extractItems(pageResult)       // pulls structured items (e.g. reviews) out
  -> Item[]                       of one page result

isDone(pageItems, dedupTracker)  // decides whether to keep paginating —
  -> boolean                       see core/pagination.js for the two proven
                                    strategies (content-hash, ID-based dedup)
```

An adapter's `processJob(job, ctx)` — the function passed into
`runWorkerPool()` (see `core/worker-loop.js`) — is expected to compose these
four pieces itself. ChiselForge's engine does not call
`resolve`/`paginate`/etc. directly; it only calls `processJob(job, ctx)`
once per job and treats a thrown error as failure, a resolved value as
success.

## Transport binding

Each adapter declares which transport it uses:

- **Browser** (`transports/browser.js`) — for sites requiring rendered DOM
  interaction (scrolling, clicking). `BrowserRuntime` for worker-pool jobs,
  `connectToLocalChrome` for an interactive search-and-resolve step.
- **HTTP** (`transports/http.js`) — for sites that serve full content via a
  plain GET (SSR pages) — check `extraction/classify.js`'s `needsBrowser`
  flag before assuming you need a browser at all.

A single adapter can use both — resolve via browser (e.g. a search-and-click
step to find the target URL), extract via HTTP once the URL is known. This
is why `resolve` and `paginate`/`extractItems` are described as separate
concerns above rather than bundled into one transport-locked object.

## Termination strategies (`core/pagination.js`)

Two proven approaches, pick based on whether items have a stable ID:

- **`hashItems` / `isRepeatedPage`** — hash a page's serialized content;
  stop when two consecutive pages hash identically. Use this when no stable
  per-item ID is available from the page's markup.
- **`DedupTracker`** — track item IDs across pages; stop when a page
  contributes zero new IDs. Use this when items carry a real, stable ID
  (e.g. a numeric review ID) — it's more precise than content hashing since
  it survives reordering across pages, which a whole-page hash would not
  catch.

## What ChiselForge will NOT do for you

- It will not tell you when a site's markup/response shape has changed —
  adapters are expected to fail loudly (throw) when extraction comes back
  empty/malformed, not silently return nothing.
- It will not solve CAPTCHAs or evade bot detection beyond what's already
  demonstrated (jittered delays, staggered startup, UA rotation, browser
  fingerprint basics, optional proxy rotation). Don't build an adapter that
  assumes more than that.
- It will not validate that your adapter is legally permitted to scrape its
  target. That's the adapter author's responsibility — document ToS
  posture in your own adapter's docs.
