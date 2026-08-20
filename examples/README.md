# Examples

Runnable, self-contained scripts against the public API (`require('../index')`
from within this directory, `require('chiselforge')` from your own project).
No production-derived adapters ship in this repo, and none are planned as a
separate public package — see [`../docs/adapters.md`](../docs/adapters.md)
for why; `custom-adapter.js` below is a clean, from-scratch illustration
instead.

Several examples exercise the LLM-backed tiers (tier 2/hydration or tier
3/text) against pages with no JSON-LD, which is most of the public web — see
[`../docs/llm-providers.md`](../docs/llm-providers.md) for provider setup.
Those examples check for `NIM_API_KEY` and print a clear message instead of
crashing if it's not set. The rest run with no key, no network cost, and no
external site at all.

| Example | Demonstrates | Needs a key? |
|---|---|---|
| `extract-basic.js` | Simplest `autoExtract(url, schema)` call | yes |
| `extract-product.js` | Typed schema against a real product page | yes |
| `extract-article.js` | List-of-items text-tier extraction | yes |
| `custom-llm-provider.js` | Swapping the LLM endpoint via `baseUrl`/`model` | no (stub server) |
| `crawl-site.js` | Multi-page discovery + crawl via `crawlSite()` | yes |
| `resumable-crawl.js` | Reusing `checkpointDir` to resume a crawl | yes |
| `worker-pool.js` | Direct `runWorkerPool()` usage — queueing, checkpointing, retry | no |
| `browser-fallback.js` | Passing `renderWithBrowser` for JS-rendered pages | no (needs `playwright`) |
| `custom-adapter.js` | Composing the engine's lower layers into a site-specific adapter | no |

Run any of them with plain Node from the repo root:

```bash
node examples/extract-basic.js
```
