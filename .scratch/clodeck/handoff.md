# Handoff — clodeck (the production build)

**Updated:** 2026-10-11
**Effort spec:** [spec-04-file-viewer.md](spec-04-file-viewer.md) — **the current slice, complete.**
Tickets 15–20 all resolved, merged into `main` as **`b0b006c`** and pushed. Terminal (spec-03) landed
at `8feeb93`. The integration branch `spec-04-file-viewer` still exists but is now redundant.
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Where this stands

Three slices are **built, documented, merged, and pushed** — `main` == `origin/main` == `8feeb93`.
The terminal slice landed as `7456803` (branch deleted) and the dev loop was fixed in `8feeb93`
(`concurrently --raw`; see the environment notes). The fourth — **the file viewer, spec-04** — is
**built, tested, code-reviewed, its review fixes merged, and the whole slice merged into `main`
(`b0b006c`) and pushed.**

The terminal slice was verified end to end **server-side against a real shell**: `/api/projects` lists
the test projects, `/ws/terminal` echoes, the shell's `cwd` is the project's directory, and resize
answers 200. The file slice is verified the same way — through `app.inject()` against real temp
directories, 176 server tests, 65 web tests, typecheck and a full build. What is still **unconfirmed**
is both browser halves: the xterm panel (keystrokes, colours, panel-resize → pty) and the new file
drawer have **never been exercised by a human** (tickets 14 and 20's gaps). That is the one thing to
close first — `npm run dev` with `PROJECTS_ROOT` set.

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
| 18 | [ScopedFs write half — branded FileName, create/rename/remove](issues/18-server-scoped-fs-write.md) | resolved |
| 19 | [Files write routes — create/rename/delete/upload](issues/19-files-write-routes.md) | resolved |
| 20 | [Web file panel — useFiles + tree/preview](issues/20-web-file-panel.md) | resolved |

So the path is real end to end for all three of the MVP's surfaces: `PROJECTS_ROOT` → allowlist →
project switcher → a project's Agent SDK session streaming over `/ws` (tool cards, approvals, history,
resume), its own raw-byte shell over `/ws/terminal` in an xterm.js panel, and its files browsed and
mutated through `/api/projects/:id/files` in the new drawer.

## What the next session is for

1. **Drive the browser by hand** — the one thing no test covers. `npm run dev` with `PROJECTS_ROOT`
   set: the xterm panel and the file drawer (tree, preview, new file/folder, rename, delete, upload)
   have never been seen by a human.
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

**Slice 04 (the file viewer) — the new ones**

- **Two files carry the whole slice.** `server/src/files/scoped-fs.ts` (both brands and every
  filesystem call) and `server/src/files/transport.ts` (all six routes). There is **no new injected
  seam**: `fs` is not a native binding, so — unlike the SDK and node-pty — the reader is tested
  against real temp directories and `buildApp({ projects, provider, spawner })` never changed. Its
  only diff against `8feeb93` is the `registerFileRoutes` import + call inside the `/api` scope.
- **The fence is compile-time, the boundary is runtime.** `ScopedPath` is minted only by `resolve()`
  and `FileName` only by `name()`, so `readFile('../../etc/passwd')` does not compile — but the brand
  evaporates at `tsc`'s exit, so every route re-validates through `realpath` containment anyway. The
  reader inlines `isInsideRoot` instead of importing `allowlist.ts` on purpose: it must *distinguish*
  `outside_root` from `not_found`, and the allowlist folds both into `null`.
- **No `WriteTarget` can name the project root.** `resolveWriteTarget('')` returns `is_root`, so
  `remove`/`rename` structurally cannot reach the root — the guard is the type, not a check in the
  ops. Writes never follow a symlink in the final segment (`lstat` + `flag:'wx'`) and never overwrite
  (`exists` → 409). TOCTOU between the `lstat` and the syscall is accepted at this scale (single user,
  loopback, no auth) — the same posture as the terminal's "cwd convenience, not a sandbox".
- **One `?path=` door now fronts all six routes.** The review found writes were skipping the syntax
  check entirely (`writeRelPath` had none), so `POST /files?path=./x` and `?path=a/../b` were **201**
  while the same path on a read was 400. The fix (`8a78fca`) deleted `writeRelPath`: `relPath` is the
  single checker, and `openProject` the single route preamble. **One observable status changed**:
  `POST /files?path=../escape.txt` was 404 (the write door folded an escaping parent into
  `outside_root`) and is now 400 (the syntax check fires first, exactly like a read). An escape
  through a *symlink* is still 404. The test asserts the 400 **and** that nothing was written outside
  the root.
- **Upload is a raw `PUT`, and it needs its own parser.** `PUT /projects/:id/files/content` takes
  `application/octet-stream` as a `Buffer`, capped by the route's `bodyLimit` — `MAX_UPLOAD_BYTES`
  (200 MiB, decision 03's default), over which Fastify answers **413 with its own envelope**, not
  `{ error }`. `registerFileRoutes` registers the octet-stream content-type parser itself; Fastify
  ships none, so without it an upload is a 415 before the handler.
- **Success bodies are `{ ok: true }`** (the terminal-size route's shape); refusals keep the
  `{ error: string }` envelope. Codes: syntax/kind → 400, unknown project / outside-root / not-found →
  404 (folded, never leaking which), exists → 409, create/upload → 201, rename/delete → 200.
- **The web drawer is `web/src/files/`** — `reducer.ts` (the pinned unions as pure transitions),
  `transport.ts` (the `fetch` layer), `useFiles.ts` (the seam: `useFiles(project) → { viewer, actions }`)
  and `FilePanel.tsx`. Content renders only as React text nodes and an escaping symlink is a
  non-navigable `<span>`; both are enforced by grep-able rules, not convention.
- **One deliberate wart**: a failed *preview* read collapses the drawer into its `error` arm and
  drops the listing (`useFiles.ts`), because the spec pins `PreviewState` with four arms and none of
  them is an error. Declined in review rather than patched — see spec-04 §Code review.
- **`AGENTS.md` was brought in line on 2026-10-11.** It said "read-only file viewer"; the standing
  decisions now read "file drawer (scoped read **+** write: new file, new folder, rename, delete,
  upload)", state the root-scoping posture (realpath containment; no symlink-follow, no overwrite, no
  root delete), and keep *content* editing out of MVP. Spec-04 §Code review records the adjudication.

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
  Developer Mode); it is skipped via `it.skipIf(win32)`. **Four** tests are now skipped this way, all
  of them symlink guards (a junction cannot express a file symlink) — spec-04 line 212 used to claim
  this was a single skip and was corrected in the review.
- **Worktrees for this slice lived at `D:/work/clodeck-wt/<name>`, outside the repo**, because
  `.claude/worktrees/` is not in `.gitignore` and a worktree there would show up as untracked. Each
  one needs its own `npm install` (seconds off the cache). Branches: `issue-18`, `issue-19`,
  `issue-20`, `review-fixes` — all merged into `spec-04-file-viewer` and safe to delete.

## Resume

```
The file-viewer slice (spec-04) is COMPLETE, merged into `main` (b0b006c), and pushed.

main == origin/main == 6ee7fb8 (the slice's merge commit is b0b006c, just below the handoff commit).
The old integration branch spec-04-file-viewer still exists (redundant).

Done (all six tickets, each with What landed + Evidence in its own file):
  - 15 shared FileEntry/FileContent          (shared/src/files.ts + index re-export)
  - 16 ScopedFs read half                     (server/src/files/scoped-fs.ts)
  - 17 GET /files + /files/content            (server/src/files/transport.ts, wired into app.ts)
  - 18 ScopedFs write half                    (same module: FileName, WriteTarget, create/rename/remove)
  - 19 POST create, POST rename, DELETE, PUT content (same transport.ts)
  - 20 web useFiles + FilePanel               (web/src/files/, replacing the Files stub in App.tsx)
  Verified after the review merge: typecheck + build clean; server 171 passed / 5 skipped, web 65 passed.

Next:
  1. Drive it by hand: PROJECTS_ROOT=D:\work\clodeck-projects npm run dev, then the drawer and the
     xterm panel — the browser half of both slices has never been seen.
  2. Optionally delete the now-redundant `spec-04-file-viewer` branch.
  3. Ticket 13's review declines still stand; spec-04 §Code review holds this slice's fixed/declined
     list. Move/download/markdown-preview/editable-toggle stay out of scope (spec-04 §Out of Scope).
  4. The remaining wayfinder slices are auth (07) and the Docker/compose/Caddy image (08).
```
