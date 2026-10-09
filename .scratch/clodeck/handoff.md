# Handoff — clodeck (the production build)

**Updated:** 2026-10-09
**Effort spec:** [spec.md](spec.md) — first slice: monorepo scaffold + `GET /api/projects`.
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Where this stands

The first slice is **built**. Tickets **01–04 are resolved** on branch `clodeck/01-monorepo-tooling-scaffold`
(one commit per ticket, plus one commit of `code-review` follow-ups, on top of `main`).

The review's one real finding — a sibling symlink making discovery return two projects with the same
`id` — is fixed with a regression test; its Standards findings (two unused exports, an unused
injection option, three duplications) are cleaned up in the same commit.

| # | Ticket | Status |
|---|--------|--------|
| 01 | [Monorepo & tooling scaffold](issues/01-monorepo-tooling-scaffold.md) | resolved |
| 02 | [Shared domain types](issues/02-shared-domain-types.md) | resolved |
| 03 | [Server projects endpoint](issues/03-server-projects-endpoint.md) | resolved |
| 04 | [Web shell + project switcher](issues/04-web-shell-project-switcher.md) | resolved |
| 05 | [Root docs + dev loop](issues/05-root-docs-dev-loop.md) | ready-for-agent — unblocked |

The path works end to end: `PROJECTS_ROOT` → allowlist-filtered discovery → `GET /api/projects` →
Vite proxy → the switcher. Verified in headless Chrome (error state + Retry, the real list through the
proxy, selection, loading state with no empty flash).

## What the next session is for

**Ticket 05** — the root README plus the final one-command dev loop. It is the last ticket of this
spec's slice; after it, the slice is done and the next effort is the chat/transport work.

Facts it needs:

- Root `dev` is provisional: it builds `shared` once, then runs `server` (`tsx watch`) and `web`
  (Vite) together via `concurrently`. Ticket 05 owns making that the documented command.
- Vite proxies `/api` to `http://127.0.0.1:3001` — `DEFAULT_PORT` in `server/src/main.ts`; `PORT`
  and `HOST` override the server (`HOST` binds loopback by default because `/api/**` is still
  unauthenticated).
- Root `build` / `typecheck` / `test` all build `shared` first, because `server` and `web` resolve it
  through its built `exports` (`shared/dist`). Per-package runs assume that build has happened.
- The switcher's verification tooling was throwaway (headless Chrome over CDP, in the OS temp dir,
  not committed) — the spec puts browser-level tests out of scope for that slice.

## Facts that live nowhere else

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`. There
  is no `docs/agents/issue-tracker.md`; `AGENTS.md` carries the convention.
- The `SDKMessage` mirror in `shared/src/sdk.ts` is **unverified** against the real
  `@anthropic-ai/claude-agent-sdk` types: the SDK is deliberately not a dependency yet, so the
  assignability check (`const payload: SDKMessage = sdkMessage`) lands with the chat bus. The mirror
  is written to be assignable-safe (wider than the SDK's types) until then.
- The symlink-to-a-file exclusion test is POSIX-only — creating a file symlink on Windows needs
  elevation or Developer Mode.
- `web` has Tailwind v4 wired through `@tailwindcss/vite`; the palette lives as `@theme` tokens in
  `web/src/index.css` (taken from the verified prototype, Variant A).

## Resume

```
implement ticket 05 (root docs + one-command dev loop) per .scratch/clodeck/issues/
```
