## What this changes and why

<!-- Focus on why, not just what — the diff already shows what changed. -->

## Testing

- [ ] `npm test` passes (fixture-based, no network — see `CONTRIBUTING.md`)
- [ ] If this touches extraction behavior, ran against a real page (not just
      unit tests) and noted the result here
- [ ] Added/updated a fixture + test case if this adds a new hydration
      format, tier behavior, or classification rule

## Scope check

- [ ] Read `docs/architecture.md`'s "Why interfaces are minimal" — this
      doesn't introduce a new abstraction (class hierarchy, plugin system)
      without a second real use case that needs it
- [ ] Doesn't add a hosted-service surface (accounts, billing, dashboard) —
      see README's "What this is not"
- [ ] No API key, proxy credential, or other secret committed
