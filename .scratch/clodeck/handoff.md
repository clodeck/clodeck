# Handoff — clodeck (the production build)

**Updated:** 2026-10-09
**Effort spec:** [spec.md](spec.md) — the slice it describes (monorepo scaffold + `GET /api/projects`) is **complete**.
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Where this stands

The first slice is **built, documented, and verified**. Tickets **01–05 are resolved** on branch
`clodeck/01-monorepo-tooling-scaffold` (one commit per ticket, plus one commit of `code-review`
follow-ups, on top of `main`).

| # | Ticket | Status |
|---|--------|--------|
| 01 | [Monorepo & tooling scaffold](issues/01-monorepo-tooling-scaffold.md) | resolved |
| 02 | [Shared domain types](issues/02-shared-domain-types.md) | resolved |
| 03 | [Server projects endpoint](issues/03-server-projects-endpoint.md) | resolved |
| 04 | [Web shell + project switcher](issues/04-web-shell-project-switcher.md) | resolved |
| 05 | [Root docs + dev loop](issues/05-root-docs-dev-loop.md) | resolved |

The path works end to end in a clean clone: `PROJECTS_ROOT` → allowlist-filtered discovery →
`GET /api/projects` → Vite proxy → the switcher, all of it reachable through the commands in the
root README, with `tsx watch` reloading the server on a source edit.

## What the next session is for

**The chat / transport slice** — the next effort, and the one the shared contracts were declared
for. No ticket set exists for it yet; split it out of the wayfinder spec (`.scratch/web-claude-ui/`)
the way `spec.md` was split, then implement. In scope per `spec.md` §Out of Scope: the WebSocket
event bus (`/ws`) and the `ClientMessage` control messages, streaming `query()` against the Agent
SDK, session history/resume.

Facts it needs:

- **The `SDKMessage` mirror in `shared/src/sdk.ts` is still unverified.** The SDK is deliberately not
  a dependency yet, so the assignability check (`const payload: SDKMessage = sdkMessage`) was never
  compiled — it lands with the chat bus. Add `@anthropic-ai/claude-agent-sdk` to `server` only, then
  pin the mirror against the real types.
- The envelope types (`shared/src/protocol.ts`) are declared and unused. That was the point: the
  transport should wire them, not re-model them.
- `/api/**` is still unauthenticated, which is why `main.ts` binds loopback by default (auth is the
  wayfinder's 07; the encapsulated `/api` scope and the `HOST` override are already in place for it).
- Root `dev` is now the documented command (README) — it builds `shared` once, then runs `server`
  (`tsx watch`) and `web` (Vite) together via `concurrently`. A `shared/` edit during `dev` needs
  `npm run build:shared`; that caveat is documented, not fixed (see ticket 05).

## Facts that live nowhere else

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`. There
  is no `docs/agents/issue-tracker.md`; `AGENTS.md` carries the convention.
- Two facts from the clean-clone run, recorded in full in ticket 05's Evidence: `npm install` prints
  `npm warn allow-scripts … esbuild@… (postinstall)` (npm 11 declining to run install scripts
  unreviewed — harmless, esbuild's binary is an optional dependency), and Vite binds `localhost` →
  `[::1]:5173` on Windows, so **probe the dev client at `localhost`, never `127.0.0.1`** — the
  backend is the opposite, binding `127.0.0.1:3001`, which is what Vite's proxy targets.
- The symlink-to-a-file exclusion test is POSIX-only — creating a file symlink on Windows needs
  elevation or Developer Mode.
- `web` has Tailwind v4 wired through `@tailwindcss/vite`; the palette lives as `@theme` tokens in
  `web/src/index.css` (taken from the verified prototype, Variant A).

## Resume

```
next effort: the chat/transport slice — split it out of .scratch/web-claude-ui/ per the clodeck
spec's Out of Scope, then implement (start with the SDK assignability check in shared/src/sdk.ts)
```
