# Adapter interface

This harness (queue, checkpoint, rate limiter, proxy pool, logger, worker
loop, both transports) has no knowledge of any specific website. An adapter
is the piece that does — it lives in a separate package (`scraper-adapters`)
and depends on this one.

There is no enforced base class or TypeScript interface yet (v0.1 is
JavaScript, and the interface below is a convention, not a runtime
contract). Three reference adapters (Google, MagicPin, Zomato) exist in
`scraper-adapters` and all follow this shape.

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
four pieces itself. The harness does not call `resolve`/`paginate`/etc.
directly; it only calls `processJob(job, ctx)` once per job and treats a
thrown error as failure, a resolved value as success.

## Transport binding

Each adapter declares which transport it uses:

- **Browser** (`transports/browser.js`) — for sites requiring rendered DOM
  interaction (scrolling, clicking). The Google adapter uses
  `BrowserRuntime` for the worker pool and `connectToLocalChrome` for its
  optional search-and-resolve step.
- **HTTP** (`transports/http.js`) — for sites that serve full content via a
  plain GET (SSR pages). Both MagicPin and Zomato adapters use this
  exclusively for extraction; Zomato additionally uses the browser
  transport, but only for its optional search-and-resolve step, never for
  extraction.

A single adapter can use both — resolve via browser, extract via HTTP — as
Zomato's `--search` mode does. This is why `resolve` and
`paginate`/`extractItems` are described as separate concerns above rather
than bundled into one transport-locked object.

## Termination strategies (`core/pagination.js`)

Two proven approaches, pick based on whether items have a stable ID:

- **`hashItems` / `isRepeatedPage`** — hash a page's serialized content;
  stop when two consecutive pages hash identically (MagicPin: no stable
  review ID was available from its DOM, so content hashing was the
  reliable signal).
- **`DedupTracker`** — track item IDs across pages; stop when a page
  contributes zero new IDs (Zomato: `reviewId` is a real, stable field, so
  ID-based dedup is more precise than hashing — it survives reordering
  across pages, which a whole-page hash would not catch).

## What the harness will NOT do for you

- It will not tell you when a site's markup/response shape has changed —
  adapters are expected to fail loudly (throw) when extraction comes back
  empty/malformed, not silently return nothing.
- It will not solve CAPTCHAs or evade bot detection beyond what's already
  proven (jittered delays, staggered startup, UA rotation, browser
  fingerprint basics, optional proxy rotation). Don't build an adapter that
  assumes more than that.
- It will not validate that your adapter is legally permitted to scrape its
  target. That's the adapter author's responsibility — document ToS
  posture per-adapter (see `scraper-adapters`' own README convention).
