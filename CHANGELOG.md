# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is pre-1.0 (`0.x`) — expect breaking changes between minor
versions until 1.0.

## [Unreleased] — stabilization pass

A narrowly-scoped follow-up fixing real behavioral bugs found in an
independent review of the 0.1.0 hardening pass below, plus a Node/Playwright
version-policy fix. Not a redesign — see each item's regression test.

### Changed
- **`package.json`'s `engines.node` raised from `>=18` to `>=20`.**
  `playwright` (a `devDependency`) itself requires Node >=20 — declaring
  `>=18` was an internally inconsistent policy nobody could actually rely
  on. CI matrix (`.github/workflows/test.yml`) updated to `[20.x, 22.x]`.
  A normal `npm install chiselforge` still does not install `playwright` or
  `undici` regardless (unaffected by this change — see the 0.1.0 entry
  below for why).
- `transports/http.js` and `transports/browser.js`'s missing-dependency
  error messages no longer say "reinstall without `--omit=optional`" —
  stale advice from when these were `optionalDependencies`. They're
  `devDependencies` now (never installed automatically for a downstream
  consumer either way); the errors just say `npm install undici` /
  `npm install playwright && npx playwright install chromium` directly.
- `crawl/crawlSite()` gained `errorBackoffMinMs`/`errorBackoffMaxMs`
  passthrough options to `runWorkerPool` (same pattern already used for
  `maxRetries`/`delayMs`) — needed to make retry behavior testable in
  reasonable time; defaults are unchanged if unset.

### Fixed
- **A JSON-LD result could short-circuit tier 1 when only SOME of several
  records validated against the schema**, e.g. `[{"name":"A","price":10},
  {"name":"B"}]` against a `name`+`price` schema was returned as the final
  result with `validation.valid: false` — violating the "URL + schema ->
  validated structured data" contract. Tightened from "at least one item
  validates" (the 0.1.0-era fix below) to "every relevant item validates"
  (`validateItems(...).valid === true`); otherwise escalates to
  hydration/text, same as "present but irrelevant." Applies identically
  whether tier 1 matched via the field-overlap heuristic or an explicit
  `jsonLdType`. No `allowPartial` API added.
- **A `renderWithBrowser()` that threw during `crawlSite()` lost the real
  error.** The render call inside `processJob` was unguarded, so the thrown
  error propagated out without ever recording a result for that URL — the
  final report fell back to the generic "not processed (worker pool did not
  report a result)" instead of the actual failure. Now caught, persisted as
  `render failed: <message>` (URL, warnings, and provenance preserved)
  before rethrowing so `runWorkerPool`'s retry/checkpoint logic still runs
  normally — a later successful retry still overwrites it with the real
  result.
- **`robotsDisallowedCount` could under-report.** `discoverFromSitemaps` and
  `crawlLinks` each independently filtered candidate pages through the same
  `isAllowed()` check, but only `crawlLinks` counted its own rejections — a
  URL disallowed by `robots.txt` that was reachable *only* via the sitemap
  (no incoming link anywhere) was correctly excluded from the result but
  invisible to the count. Fixed by recording rejections into one `Set`
  shared by both discovery sources, inside `isAllowed()` itself — fixes the
  undercount and (via `Set` semantics) guarantees a URL disallowed and
  present in both sources is still counted exactly once, not twice.

## [0.1.0] — initial public release

The first published version: `autoExtract()`'s tiered pipeline (JSON-LD →
hydration-state+LLM → raw-text+LLM), schema validation, confidence scoring,
the CLI (`extract` / `crawl`), multi-page crawling (`crawlSite` /
`discoverPages`), and the underlying engineering layer (`runWorkerPool`,
`JobQueue`, checkpointing, `RateLimiter`, `ProxyPool`, structured logging)
generalized from earlier production scraping pipelines — plus a pre-launch
hardening pass on top before publishing. See `docs/architecture.md` and
`docs/benchmarks.md` for what's actually been measured.

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
