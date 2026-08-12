# LLM tier configuration

`extraction/llm.js` is used by tiers 2 and 3 of `autoExtract()` — see
[`EXTRACTION_STRATEGIES.md`](EXTRACTION_STRATEGIES.md) for when each fires.
It's a thin wrapper around any OpenAI-compatible `/chat/completions`
endpoint. Nothing about it is NVIDIA-specific by design, even though it
defaults to NVIDIA NIM and was built/tested against it.

## Never commit an API key

Supply it one of two ways — never as a literal string in your source:

```bash
export NIM_API_KEY="your-key-here"
```

```js
await extractWithLLM(pageHtml, schema, { apiKey: process.env.NIM_API_KEY });
```

The CLI reads `NIM_API_KEY` automatically, or accepts `--api-key` for a
one-off override.

## Model selection

**Real finding from testing, not a hypothetical warning:** NIM
personal/deployment API keys are often scoped to specific model
"functions," not the full public model catalog. Requesting a model outside
a key's scope either returns a fast `404` (`Function '...' not found for
account`) or — worse — hangs with no response until a `504` gateway
timeout (seen after ~5 minutes in testing). Neither is instantly obvious as
"wrong model name" from the error alone.

Nemotron models were confirmed working reliably across every key tested:

- `nvidia/llama-3.3-nemotron-super-49b-v1` (default — strong instruction
  following, ~10s typical latency for larger prompts)
- `nvidia/llama-3.3-nemotron-super-49b-v1.5`
- `nvidia/nemotron-3-nano-30b-a3b` (faster, lighter)
- `nvidia/llama-3.1-nemotron-nano-8b-v1` (fastest)

If your key is scoped differently, pass `model` explicitly. If a request
hangs rather than erroring, that's the 404-vs-504 pattern above — try a
Nemotron model or confirm your key's actual scope with NVIDIA.

## Using a different provider

```js
await extractWithLLM(pageHtml, schema, {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
});
```

Any endpoint implementing the same `/chat/completions` shape works
identically — a local Ollama server, OpenRouter, Together, etc.

## Reliability notes from real testing

Two behaviors were found and fixed while building this, both real, both
worth knowing if you're calling `extractWithLLM` directly rather than
through `autoExtract`:

1. **No `max_tokens` set → silent truncation risk.** Reasoning models can
   spend a meaningful chunk of their completion budget on chain-of-thought
   before emitting the actual JSON. The default (`maxTokens: 4096`,
   `autoExtract`'s hydration tier uses 8192) is a starting point, not a
   guarantee — raise it if you see empty/truncated results on a
   many-item extraction.
2. **Temperature 0 does not guarantee determinism.** Directly observed: an
   identical request against data confirmed present and well within the
   truncation window returned a clean, valid `[]` (`finish_reason: "stop"`,
   not an error) on one run and 5 correct items on another. This is a known
   characteristic of hosted inference (server-side batching/quantization
   variance), not a bug in this code. `autoExtract` guards against it with a
   single bounded retry (`extractWithRetryOnEmpty` in `extraction/auto.js`)
   when a tier comes back empty — if you're calling `extractWithLLM`
   directly, consider doing the same.

## Prompt structure

`buildSystemPrompt(schema, instructions)` (exported from `extraction/llm.js`)
builds the system message: your schema (as a JSON example, with each field's
description string), a hard instruction to return only a JSON array, and any
`instructions` you pass. For the hydration tier specifically, `auto.js` adds
a generic (non-site-specific) instruction to search nested structure before
concluding nothing matches — see `EXTRACTION_STRATEGIES.md` for why that
was necessary.
