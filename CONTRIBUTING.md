# Contributing

## Before you start

Read [`docs/architecture.md`](docs/architecture.md) — it explains why interfaces here
are minimal rather than heavily abstracted, and what's intentionally not
built yet (see its "Roadmap" section). If you're about to add a
`PageClassifier` class hierarchy or a pluggable `StrategySelector`, check
whether there's actually a second implementation that needs it — this
project deliberately avoids abstraction ahead of a second real use case.

## Running tests

```bash
npm test
```

All committed tests are fixture-based (`test/fixtures/*.html`) — no live
network calls. If you're adding a test that needs a real page or a live LLM
call, it belongs in `benchmark/`, not `test/` — see
[`docs/benchmarks.md`](docs/benchmarks.md) for that distinction and why it matters.

## Adding a hydration-state format

If you find a site using a hydration global not in
`extraction/classify.js`'s `KNOWN_HYDRATION_GLOBALS`, add it there (both the
escaped-string and direct-object-literal parsing already handle either
shape) and add a fixture + test case in `test/fixtures/` +
`test/classify.test.js` following the existing pattern.

## Adding an adapter

Site-specific extraction logic (adapters) isn't published from this repo —
see [`docs/adapters.md`](docs/adapters.md) for why and how to build your own against
the public interface (`docs/adapter-interface.md`).

## Reporting a bug in the LLM tier

Before filing, check [`docs/llm-providers.md`](docs/llm-providers.md)'s "Reliability notes" — a request
that hangs or returns an empty `[]` may be a known NIM key-scoping issue or
temperature-0 non-determinism, not a code bug. If it's neither, include
`--verbose` CLI output (or the `onStep` trail if using the JS API) so the
failing tier is clear.

## What not to add

See the README's "What this is not" section — no hosted service, no
billing, no accounts, no dashboard, no distributed queue (yet — see
`docs/architecture.md`'s roadmap for why that's deliberately deferred, not
rejected). Keep pull requests scoped to the engine and its documented
extension points.

## Security

Never commit an API key, proxy credential, or any file containing one (see
`.gitignore` — `.env`, `.env.local`, `proxies.txt`, and `api keys.txt` are
all excluded; keep it that way in any PR). If you find a credential
accidentally committed in this repo's history, report it privately rather
than opening a public issue.
