# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, email **subrojitroy@polynovea.in** with:

- a description of the issue and its potential impact;
- steps to reproduce (a minimal repro against this repo's public API is ideal);
- the affected version (`npm ls chiselforge` or your `package.json`).

You should receive an acknowledgement within a few days. Once a fix is
available, a new version will be published and, where appropriate, a
GitHub Security Advisory will be filed crediting the report unless you
prefer to remain anonymous.

## Supported versions

ChiselForge is pre-1.0 (`0.x`). Only the latest published `0.x` release is
supported — there is no parallel maintenance of older minor versions yet.

## Scope notes

- ChiselForge is a local/self-hostable library and CLI — it has no hosted
  service, accounts, or billing surface to report against.
- If you find a credential, API key, or other secret accidentally committed
  in this repository's history, report it the same way (privately) rather
  than opening a public issue — see `CONTRIBUTING.md`.
- Reports about the behavior of third-party sites this tool is pointed at
  (e.g. a specific website's bot-detection or ToS posture) are out of scope
  for this repository; this project doesn't control target sites.
