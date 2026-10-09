# Handoff — clodeck (the production build)

**Updated:** 2026-10-09
**Effort spec:** [spec.md](spec.md) — first slice: monorepo scaffold + `GET /api/projects`.
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Where this stands

The wayfinder effort (`.scratch/web-claude-ui/`) is complete — spec + verified prototype, product named **Clodeck**, repo live on GitHub (branch `main`). The build effort is **clodeck**. Its first spec ([spec.md](spec.md)) is written and broken into **5 implementation tickets**, all `Status: ready-for-agent`, under [issues/](issues/):

| # | Ticket | Blocked by |
|---|--------|-----------|
| 01 | [Monorepo & tooling scaffold](issues/01-monorepo-tooling-scaffold.md) | — |
| 02 | [Shared domain types](issues/02-shared-domain-types.md) | 01 |
| 03 | [Server projects endpoint](issues/03-server-projects-endpoint.md) | 02 |
| 04 | [Web shell + project switcher](issues/04-web-shell-project-switcher.md) | 02, 03 |
| 05 | [Root docs + dev loop](issues/05-root-docs-dev-loop.md) | 04 |

No product code exists yet — the repo is greenfield (only `.scratch/` + skills + `AGENTS.md`).

## What the next session is for

Implement the tickets in dependency order. The frontier right now is **ticket 01** (no blockers): set `Status: claimed`, implement, then mark it resolved and move to 02 → 03 → 04 → 05.

## Facts that live nowhere else

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`.

## Resume

```
implement ticket 01 (monorepo scaffold), then 02 → 03 → 04 → 05 per .scratch/clodeck/issues/
```
