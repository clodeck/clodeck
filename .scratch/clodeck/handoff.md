# Handoff — clodeck (the production build)

**Updated:** 2026-10-10
**Effort spec:** [spec-04-file-viewer.md](spec-04-file-viewer.md) — **the current slice.** Tickets 15–17 resolved (uncommitted), 18–20 ready. Terminal (spec-03) is merged/pushed at `8feeb93`.
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Where this stands

Three slices are **built, documented, merged, and pushed** — `main` == `origin/main` == `8feeb93`.
The terminal slice landed as `7456803` (branch deleted) and the dev loop was fixed in `8feeb93`
(`concurrently --raw`; see the environment notes).

The slice was verified end to end **server-side against a real shell**: `/api/projects` lists the
test projects, `/ws/terminal` echoes, the shell's `cwd` is the project's directory, and resize
answers 200. What is still **unconfirmed** is the browser half: the xterm panel itself (keystrokes,
colours, panel-resize → pty) has never been exercised by a human (ticket 14's gaps). That is the one
thing to close first.

A local test root now exists at **`D:\work\clodeck-projects`** (`hello/` and `demo/`) — use it with
`PROJECTS_ROOT` to drive the terminal or the file viewer by hand.

| # | Ticket | Status |
|---|--------|--------|
| 01–05 | monorepo, shared types, `GET /api/projects`, web shell | resolved (see [spec.md](spec.md)) |
| 06 | [SDK dependency, mirror pin, widening](issues/06-sdk-dep-pin-mirror.md) | resolved |
| 07 | [SDK provider facade, session types, fake](issues/07-sdk-provider-fake.md) | resolved |
| 08 | [WebSocket bus, control messages, approvals](issues/08-ws-bus-control-approvals.md) | resolved |
| 09 | [Session history REST](issues/09-session-history-rest.md) | resolved |
| 10 | [Web chat, streaming renderer, approval modal](issues/10-web-chat-renderer.md) | resolved |
| 11 | [Web history, resume, continue-latest](issues/11-web-history-resume.md) | resolved |
| 12 | [Server terminal seam — pty facade, node-pty, manager](issues/12-server-terminal-seam.md) | resolved |
| 13 | [Terminal transport — raw `/ws/terminal` + resize REST](issues/13-terminal-transport.md) | resolved |
| 14 | [Web terminal — xterm.js panel](issues/14-web-terminal-panel.md) | resolved |
| 15 | [Shared file types — `FileEntry` / `FileContent`](issues/15-shared-file-types.md) | resolved |
| 16 | [ScopedFs read half — `ScopedPath`, resolve/listDir/readFile](issues/16-server-scoped-fs-read.md) | resolved |
| 17 | [Files read routes — GET listing + content](issues/17-files-read-routes.md) | resolved |
| 18 | [ScopedFs write half — branded FileName, create/rename/remove](issues/18-server-scoped-fs-write.md) | ready |
| 19 | [Files write routes — create/rename/delete/upload](issues/19-files-write-routes.md) | ready |
| 20 | [Web file panel — useFiles + tree/preview](issues/20-web-file-panel.md) | ready |

So the path is real end to end for both halves of the primary interaction: `PROJECTS_ROOT` → allowlist →
project switcher → a project's Agent SDK session streaming over `/ws` (tool cards, approvals, history,
resume) **and** its own raw-byte shell over `/ws/terminal` in an xterm.js panel.

## What the next session is for

1. **Finish the file-viewer slice** (spec-04), already spec'd and part-built: tickets 15–17 resolved
   (uncommitted), 18–20 ready. The write half (18–19) and the web panel (20) remain. The `Files`
   cell in `web/src/App.tsx` is still the `Stub`; `resolveProject` and the `/api` scope are the
   seams (already wired for the read routes).
2. The remaining, non-MVP wayfinder slices — still **unticketed**:
- **Auth** (wayfinder 07) — single-account login. Until it lands, `/api/**`, `/ws`, and
  `/ws/terminal` are unauthenticated, which is exactly why `main.ts` binds loopback by default. The
  encapsulated `/api` scope and the `HOST` override are already in place, and the resize endpoint
  already sits inside that scope; `/ws` and `/ws/terminal` are sibling routes the same
  principal-aware hook must front.
- **Docker image / compose / Caddy** (wayfinder 08) — `GET /healthz` is already there for it. Note
  node-pty is a native binding: the image needs a glibc base (the `node:22-bookworm-slim` plan) and
  a working shell in the container.

## Facts that live nowhere else

**Slice 01–02 (still true)**

- **The mirror pin is load-bearing and subtle.** `server/src/sdk/mirror.ts` is the only place the real
  SDK union meets the hand-written mirror in `shared/src/sdk.ts`. Its `case` arms *are* the pin. The
  three named `system` arms assign to an **annotated** target (`const mirrored: SDKSystemInitMessage =
  message`) on purpose: the mirror's `SDKSystemOtherMessage` catch-all types `subtype: string`, so a
  plain `return message` would absorb any system message and pin nothing. Add a fourth arm the same
  way. `import type` only — the module has no runtime SDK dependency, which is what keeps the tests
  fast and offline.
- **Exactly one mirror field has ever needed widening**: `UserApiMessage.role` gained `'system'`.
  Widen the mirror; never redesign the envelope.
- **`shared/src/protocol.ts` is frozen.** No ticket has edited it since slice 01 — including all of
  the terminal slice, whose channel carries raw bytes precisely so it stays out of the envelope. If a
  change seems to need one, that is a signal to re-read the ticket, not to edit the file.
- **`SdkProvider` is the only SDK surface the server knows** (`server/src/sdk/provider.ts`, no SDK
  import); the real one is `server/src/sdk/anthropic.ts`, the scripted fake is
  `server/src/testing/fake-provider.ts` (`holdRuns`/`releaseRuns`/`failRuns` make
  `turn_in_progress`, `interrupt` and the mid-turn failure reachable deterministically).
- **`PtySpawner` is the second facade, for the same reason** (`server/src/terminal/pty.ts`; the real
  spawner `terminal/node-pty-spawner.ts` is the only module that imports `node-pty`, and
  `testing/fake-pty.ts` is the scripted fake). `TerminalManager` (`terminal/manager.ts`) turns it into
  one shell per project: `open` **replaces** (kills) an existing handle, and an exit reaps only the
  entry that is still live.
- **`server/src/testing/` is excluded from `dist`** (`server/tsconfig.build.json`). `npm run dev:fake`
  (root) boots the app on the fake provider — no API key, no network. **But `dev-fake` also injects the
  fake *spawner***, so the terminal there has no shell behind it; for a real shell by hand use
  `npm run dev` (the key is only needed when a prompt is actually sent).
- **`snapshot.payload.lastSeq` is always `0`** (`seq` is per-connection and resets on reconnect; the
  snapshot is always the first frame, `seq: 1`).
- **`resume` only arms a target.** It never sends a prompt; the next `send_prompt` reads and clears it.
  The client clears its banner on `stream_status: turn_started` and keeps it on a `turn_in_progress`
  rejection.
- **Known chat warts, recorded in tickets 10 and 11 rather than hidden**: an optimistic user bubble
  survives a `turn_in_progress` rejection; a snapshot landing before its echo can drop one; an armed
  resume cannot be cancelled (no clear-target message); a reload loses the resume *banner* though the
  server's target survives; Resume while the socket is not OPEN no-ops silently. The chat React layer
  has **no rendered test**.

**Slice 03 (the terminal) — the new ones**

- **`/ws/terminal` is raw bytes out of one module.** `server/src/terminal/transport.ts`
  (`registerTerminalSocket`, `registerTerminalSizeRoute`) holds the route, the ownership map and the
  resize endpoint. `WS_OPEN`/`textOf` now live once in `server/src/ws/frames.ts`, shared with
  `ws/bus.ts`. Do not add a framing layer or an envelope here — ticket 13's review declined client-side
  flow control for exactly that reason (a framed PAUSE/RESUME channel is out of MVP scope).
- **The `owners` map is what makes a reload safe.** The manager keeps one shell per project and `open`
  replaces it, so a socket can outlive its shell. Only the current owner may write to or close a
  project's shell; delete that guard and a stale socket silently feeds bytes into — and then kills —
  the *newer* shell. The test in `transport.test.ts` fails against the naive version; keep it.
- **`@fastify/websocket` is registered exactly once, in `buildApp` (`server/src/app.ts`)**, because
  its `websocket: true` handling is an `onRoute` hook. `registerWsBus` used to register it itself;
  registering it a second time from a route plugin throws `FST_ERR_DEC_ALREADY_PRESENT`.
- **Resize is REST, deliberately**: `POST /api/projects/:id/terminal/size` (`200` / `404` no terminal
  or unknown project / `400` bad body), inside the `/api` scope so the future auth hook covers it. The
  client pushes its real size once on socket open (the server spawns at a fixed 80×24) and debounces
  `terminal.onResize` by 150 ms.
- **The attach addon never sends a size** (research 02 §2) — resize must be wired by hand, which is
  why `@xterm/addon-fit` joined the two packages spec-03 names: user story 8 needs the grid to
  actually change before anything is worth posting.
- **Web tests run in vitest's default node environment** (no `jsdom`, no `vitest.config.*`), and
  `web/src/App.test.tsx` loads the whole `App` graph — including `@xterm/xterm`. That static import is
  safe today; moving xterm behind a dynamic import would be the way to shrink the 584 kB bundle, and
  the way to find out is `npm test`.
- **The terminal panel has never been seen in a browser.** The server half is verified down to a real
  ConPTY shell by hand; the DOM half is typecheck + build + seven pure-edge tests only.
- **The slice's review declines** (ticket 13's `## Code review` section, with reasons): client-side
  flow control, a shutdown hook for `TerminalManager.dispose()`, sharing `notFound` with
  `sessions.ts`, and removing `@xterm/addon-fit` or the web `transport.test.ts`.

## Environment notes (still true)

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`. There
  is no `docs/agents/issue-tracker.md`; `AGENTS.md` carries the convention. There is also no
  `map.md` for this effort — `handoff.md` is the map.
- No `gh` CLI on this machine: work is closed by marking the ticket `Status: resolved` and committing
  `close ticket NN: …`.
- Worktrees are cheap here: `npm install` in a fresh worktree takes seconds off the npm cache, and the
  Agent SDK adds ~40s the first time only. **Every new worktree needs its own `npm install`** — and
  after the terminal slice, also whatever the branch's lockfile added (`node-pty`, the xterm packages).
- npm 11 does not run install scripts by default (it warns about `node-pty`, `esbuild`). node-pty
  ships prebuilds, so the binding loads and spawns anyway; no approval is needed unless a future bump
  drops them.
- Vite binds `localhost` → `[::1]:5173` on Windows, so probe the dev client at `localhost`, never
  `127.0.0.1`; the backend is the opposite, binding `127.0.0.1:3001`, which is what the proxy targets.
  `/ws` is proxied with `ws: true`, so `/ws/terminal` rides the same prefix — no proxy change needed.
- **`npm run dev` passes `--raw` to `concurrently` on purpose** (README has the reasoning): with the
  `-n server,web` prefixes, `concurrently`'s line-prefixing streams deadlock the real Agent SDK's
  import under `tsx watch`, and the server silently never listens (the client then 502s). This is
  pre-existing — `dev:fake` never imports the SDK, which is exactly why it was never noticed. Restore
  the prefixes and you re-break `npm run dev`.
- **`npm run dev` needs `PROJECTS_ROOT`** (or `clodeck.config.json` in `server/`) or the project list
  is empty by design — an empty list is not an error, so it looks like a broken UI when it is an
  unconfigured server. `npm run dev:fake` plus a `PROJECTS_ROOT` is the offline loop. Locally:
  `set PROJECTS_ROOT=D:\work\clodeck-projects && npm run dev` (cmd) — that folder holds `hello/` and
  `demo/`, which is what the by-hand terminal checks were run against.
- The symlink-to-a-file test is POSIX-only (creating a file symlink on Windows needs elevation or
  Developer Mode); it is skipped via `it.skipIf(win32)`. It is the suite's only skip.

## Resume

```
The file-viewer slice (spec-04) is spec'd and part-built, all UNCOMMITTED on `main`.

Done:
  - 15 shared FileEntry/FileContent            (shared/src/files.ts + index re-export)
  - 16 ScopedFs read half                       (server/src/files/scoped-fs.ts)
  - 17 GET /files + /files/content routes       (server/src/files/transport.ts, wired into app.ts)
  Verified: typecheck clean; server 127 passed / 1 skipped, web 34 passed.

To do, in order:
  1. Ticket 18: ScopedFs write half — branded `FileName` + `name()`, `WriteTarget`/`WriteTargetResult`/
     `WriteResult`, `resolveWriteTarget`, `createFile`/`createDirectory`/`rename`/`remove`.
     Implement in scoped-fs.ts + unit tests (real temp dirs).
  2. Ticket 19: write routes in transport.ts — POST create, POST rename, DELETE, PUT content
     (raw octet-stream, 200 MiB bodyLimit).
  3. Ticket 20: web useFiles + FilePanel, replacing the `Files` stub in web/src/App.tsx.

Reads are already testable: npm run dev with PROJECTS_ROOT=D:\work\clodeck-projects, then
GET /api/projects/:id/files. The write ops follow decision 03 (new file/folder, rename, delete,
upload); move/download/markdown-preview/editable-toggle stay out of scope (spec-04 §Out of Scope).
```
