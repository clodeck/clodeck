# Handoff — clodeck (the production build)

**Updated:** 2026-10-10
**Effort spec:** [spec-03-terminal.md](spec-03-terminal.md) — speced and ticketed, **not yet implemented** (run `/implement-spec`).
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Where this stands

Two slices are **built, documented, and verified**, both on branch `clodeck/06-11-chat-transport`
(which will have been merged into `main` before you read this):

| # | Ticket | Status |
|---|--------|--------|
| 06 | [SDK dependency, mirror pin, widening](issues/06-sdk-dep-pin-mirror.md) | resolved |
| 07 | [SDK provider facade, session types, fake](issues/07-sdk-provider-fake.md) | resolved |
| 08 | [WebSocket bus, control messages, approvals](issues/08-ws-bus-control-approvals.md) | resolved |
| 09 | [Session history REST](issues/09-session-history-rest.md) | resolved |
| 10 | [Web chat, streaming renderer, approval modal](issues/10-web-chat-renderer.md) | resolved |
| 11 | [Web history, resume, continue-latest](issues/11-web-history-resume.md) | resolved |

Slice 01 (tickets 01–05, monorepo + `GET /api/projects`) was already complete; see
[spec.md](spec.md). Together they mean the path is real end to end: `PROJECTS_ROOT` → allowlist →
project switcher → a project's Agent SDK session streaming over `/ws` → tool cards, the approval
modal, session history and resume.

The **terminal slice** is the current one: [spec-03-terminal.md](spec-03-terminal.md) is speced and
tickets [12](issues/12-server-terminal-seam.md)–[14](issues/14-web-terminal-panel.md) are ticketed
(a linear chain: 12 pty seam → 13 transport → 14 web panel). Nothing is implemented yet.

## What the next session is for

**Implement the terminal slice.** [spec-03-terminal.md](spec-03-terminal.md) is speced and
[12–14](issues/) are ticketed. The whole session is one call: `/implement-spec` (frontier 12 → 13 →
14). After it lands, the remaining wayfinder slices — still unticketed:

- **Read-only file viewer / file drawer** (wayfinder 03).
- **Auth** (wayfinder 07) — single-account login. Until it lands, `/api/**`, `/ws`, and
  `/ws/terminal` are unauthenticated, which is exactly why `main.ts` binds loopback by default. The
  encapsulated `/api` scope and the `HOST` override are already in place; `/ws` and `/ws/terminal`
  are sibling routes the same principal-aware hook must front.
- **Docker image / compose / Caddy** (wayfinder 08) — `GET /healthz` is already there for it.

## Facts that live nowhere else

- **The mirror pin is load-bearing and subtle.** `server/src/sdk/mirror.ts` is the only place the real
  SDK union meets the hand-written mirror in `shared/src/sdk.ts`. Its `case` arms *are* the pin. The
  three named `system` arms assign to an **annotated** target (`const mirrored: SDKSystemInitMessage =
  message`) on purpose: the mirror's `SDKSystemOtherMessage` catch-all types `subtype: string`, so a
  plain `return message` would absorb any system message and pin nothing. Add a fourth arm the same
  way. `import type` only — the module has no runtime SDK dependency, which is what keeps the tests
  fast and offline.
- **Exactly one mirror field has ever needed widening**: `UserApiMessage.role` gained `'system'`,
  because the API's `MessageParam.role` is `'user' | 'assistant' | 'system'`. Everything else the
  ticket predicted (branded `uuid`, literal `assistant.error`, `BetaRawMessageStreamEvent`) was
  already absorbed. Widen the mirror; never redesign the envelope.
- **`shared/src/protocol.ts` is frozen.** No ticket has edited it since slice 01. If a change seems to
  need one, that is a signal to re-read the ticket, not to edit the file.
- **`SdkProvider` is the only SDK surface the server knows** (`server/src/sdk/provider.ts`, no SDK
  import). The real implementation lives in `server/src/sdk/anthropic.ts`; everything else — the bus,
  the REST routes, every test — talks to the facade. `server/src/testing/fake-provider.ts` is the
  scripted fake; `holdRuns`/`releaseRuns`/`failRuns` exist so `turn_in_progress`, `interrupt` and the
  mid-turn failure path are reachable deterministically.
- **`server/src/testing/` is excluded from `dist`** (`server/tsconfig.build.json`). `npm run dev:fake`
  (root) boots the app on the fake provider — no API key, no network. Use it for any UI work.
- **`snapshot.payload.lastSeq` is always `0`.** `seq` is per-connection and resets on reconnect (the
  envelope's own doc comment), so a fresh connection has seen nothing; the snapshot itself is `seq: 1`
  and is always the first frame.
- **`resume` only arms a target.** It never sends a prompt; the next `send_prompt` consumes it. The
  client clears its banner on `stream_status: turn_started`, and keeps it on a `turn_in_progress`
  rejection (the server consumed nothing).
- **Known warts, recorded in tickets 10 and 11 rather than hidden**: an optimistic user bubble
  survives a `turn_in_progress` rejection; an optimistic bubble can be dropped by a snapshot that
  lands before its echo; there is no way to *cancel* an armed resume (the protocol has no
  clear-target message); a reload loses the resume *banner* even though the server's target survives
  (the snapshot carries no resume target); pressing Resume while the socket is not OPEN no-ops
  silently while the banner still shows. The React layer has **no rendered test** — the spec puts
  browser e2e out of scope, and the client is verified by typecheck/build plus reducer tests and
  by-hand socket checks.
- **The code review declined these on purpose** (do not "fix" them without new information): the
  parse→dispatch split across `ws/client-message.ts` and `ws/bus.ts` (that separation *is* the trust
  boundary); the local `Envelope` interface in `ws/turn-manager.ts` (drift is caught at the
  `EmitDraft` emit site); `SdkRunInput.signal` / `SdkRunInput.permissionMode` (both pinned by the
  spec's provider interface though no caller sets them today).
- **`ws` is a devDependency** and is imported **type-only** in `server/src/ws/bus.ts`; the production
  dependency is `@fastify/websocket`. Adding a runtime `ws` import to server source would change that.

## Environment notes (still true)

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`. There
  is no `docs/agents/issue-tracker.md`; `AGENTS.md` carries the convention.
- Worktrees are cheap here: `npm install` in a fresh worktree takes seconds off the npm cache, and the
  Agent SDK adds ~40s the first time only.
- Vite binds `localhost` → `[::1]:5173` on Windows, so probe the dev client at `localhost`, never
  `127.0.0.1`; the backend is the opposite, binding `127.0.0.1:3001`, which is what the proxy targets.
- The symlink-to-a-file test is POSIX-only (creating a file symlink on Windows needs elevation or
  Developer Mode); it is skipped via `it.skipIf(win32)`.

## Resume

```
implement the terminal slice — /implement-spec on tickets 12 → 13 → 14 (spec-03-terminal.md)
```
