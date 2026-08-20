# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is pre-1.0 (`0.x`) — expect breaking changes between minor
versions until 1.0.

## [Unreleased] — pre-launch hardening

### Added
- `examples/` — nine runnable example scripts covering basic extraction,
  typed schemas, custom LLM providers, crawling, resumable crawls, direct
  worker-pool usage, browser fallback, and a from-scratch adapter.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, this `CHANGELOG.md`.
- `types/index.d.ts` — hand-written TypeScript declarations for the full
  public API.
- `package.json`: `author`, `repository`, `bugs`, `homepage`, `files`
  allow-list, an explicit `exports` map, and a `benchmark` npm script.
- Friendly errors when an optional dependency (`playwright`, `undici`) is
  missing at the point a call actually needs it, instead of a raw
  `Cannot find module` error.
- `crawl/discover.js` now parses and respects `robots.txt`
  `User-agent`/`Disallow`/`Allow` directives (`respectRobots: true` by
  default on `discoverPages()`/`crawlSite()`, `--ignore-robots` to opt out
  on the CLI) — previously `robots.txt` was fetched only for its
  `Sitemap:` lines, and every path on a site was discoverable regardless of
  what its own `robots.txt` disallowed.
- `extraction/auto.js`'s `autoExtract()` gained `options.browserUsed`, so a
  caller that already resolved a page via browser rendering before calling
  in (e.g. `crawlSite`) can report that accurately in provenance.

### Changed
- Moved `ARCHITECTURE.md`, `EXTRACTION_STRATEGIES.md`, `ADAPTERS.md`,
  `adapter-interface.md`, `LLM.md`, `BENCHMARKS.md`, and `QUICKSTART.md`
  into `docs/` (lowercase, hyphenated filenames) to keep the repo root
  focused on adoption (`README.md`, `CONTRIBUTING.md`, license/community
  files).
- README: hero now leads with "Web extraction that knows when not to use an
  LLM," plus an explicit "Why ChiselForge?" section and a restrained "Built
  from real infrastructure" section (Polynovea origin, without overclaiming
  that this exact public codebase has run in production).
- `package.json`'s `files` allow-list means `npm pack` no longer ships
  tests, benchmark fixtures, or CI config.
- **`playwright` and `undici` moved from `optionalDependencies` to
  `devDependencies`.** `optionalDependencies` are still installed by npm by
  default, so `npm install chiselforge` was pulling both in regardless —
  contradicting the "lightweight until browser rendering is actually
  needed" claim. `devDependencies` are never installed for a package
  consumed as a dependency, so a plain `npm install chiselforge` now
  installs neither; `npm install` inside this repo (for contributors, CI,
  `benchmark/`) still gets both automatically.
- Terminology: renamed "same-origin" to "same-host" throughout code
  comments/docs — the actual check (`crawl/discover.js`'s `sameSitePage`)
  compares hostname only, not full origin (scheme+host+port), so calling it
  "same-origin" overclaimed precision the check doesn't have. Also renamed
  `extraction/classify.js`'s `stripToVisibleText`/`visibleTextLength` to
  `stripToSourceText`/`sourceTextLength` — it strips HTML tags from raw
  source, it does not compute real CSS-rendered visibility.
- `docs/quickstart.md`'s crawl section corrected: re-running with the same
  `--output` directory does **not** resume a crawl (that was a documentation
  error) — resuming requires explicitly reusing the same `--checkpoint-dir`
  across invocations, which is now shown.

### Fixed
- `test/llm-provider-swap.test.js` fetched `https://example.com/` for real,
  giving the "offline, fixture-based" test suite a live network dependency
  it wasn't supposed to have. Now passes `options.html` directly, so the
  suite makes zero outbound network calls.
- **`crawlSite()` reported `browserUsed: false` for pages that genuinely
  required a browser.** It resolves rendering itself and hands the result to
  `autoExtract()` via `options.html`; `autoExtract()` only used to set
  `browserUsed` when it rendered the page itself, so a browser render that
  happened one level up was invisible to the returned provenance — a real
  problem for a project whose central claim is honest provenance. Fixed via
  the new `options.browserUsed` passthrough.
- **A JSON-LD block relevant to the schema but missing a requested field was
  returned as the final (invalid) result instead of escalating.** e.g. a
  `Product` block with `name`/`price` against a schema also asking for
  `rating` was returned as-is, silently answering a narrower question than
  the one asked — contradicting "escalate only when the cheaper tier can't
  actually answer the request." Tier 1 now only short-circuits when at
  least one JSON-LD item genuinely validates against the schema.
- **A provider returning a single bare JSON object instead of an array
  crashed extraction** (`items.map is not a function`) — a real response
  shape for single-entity pages despite the system prompt asking for an
  array. `extraction/llm.js` now normalizes a bare object to a one-item
  array at the boundary.
- `examples/worker-pool.js` inherited `runWorkerPool`'s 20-40s default
  error-backoff, so its "runs instantly" demo could sit for up to 40s after
  its simulated failure with no visible explanation. Backoff turned down for
  the demo specifically.
- `examples/resumable-crawl.js` used a fixed (non-randomized) checkpoint
  directory, so a second run of the *script itself* (a separate `node`
  invocation, not the two in-script calls it's actually demonstrating) would
  silently see state left over from a previous run instead of a genuinely
  fresh "first run." Now resets that directory at the start of each script
  execution.
- `types/index.d.ts`: `http.FetchHtmlOptions` incorrectly listed
  `renderOnBlock` (that option belongs to the higher-level
  `autoExtract`/`crawlSite`/`discoverPages` APIs, which map it down to
  `fetchHtml`'s real option, `allowBotBlockFallback`) — removed.
  `llm.extractWithLLM`'s return type corrected from `Promise<any>` to
  `Promise<any[]>` to match the object→array normalization fix above.

## [0.1.0] — initial engine

The first working version of the engine described in this repo: `autoExtract()`'s
tiered pipeline (JSON-LD → hydration-state+LLM → raw-text+LLM), schema
validation, confidence scoring, the CLI (`extract` / `crawl`), multi-page
crawling (`crawlSite` / `discoverPages`), and the underlying engineering
layer (`runWorkerPool`, `JobQueue`, checkpointing, `RateLimiter`,
`ProxyPool`, structured logging) generalized from earlier production
scraping pipelines. See `docs/architecture.md` and `docs/benchmarks.md` for
what's actually been measured.
