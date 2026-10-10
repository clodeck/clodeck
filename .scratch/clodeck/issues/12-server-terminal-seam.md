# 12: Server terminal seam — pty facade, node-pty dep, terminal manager

**What to build:** The shell that the terminal will later drive has a testable seam: node-pty sits behind a small interface so automated tests never fork a real shell, and a manager owns one shell per project with a full lifecycle — spawn on open, write, resize, kill on close, reap on exit. No route yet; this is the foundation the transport and the client hang off.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `node-pty` is a `server`-only dependency; no other package imports it.
- [x] A `PtySpawner` interface (`spawn`) and a `PtyHandle` (`write` / `resize` / `kill` / `pause` / `resume` / `onData` / `onExit`) exist; the real impl spawns the platform shell (`powershell.exe` on Windows, `$SHELL`/`bash` on POSIX) with `cwd`, `cols`/`rows`, `TERM=xterm-256color`, and `COLORTERM=truecolor`.
- [x] A scripted fake spawner lives in test-support (excluded from `dist`), so automated tests never fork a shell.
- [x] A terminal manager owns one pty per project (`Map<projectId, handle>`); spawn / write / resize / kill / dispose target the right handle, and exit reaps the entry.
- [x] Unit tests drive the manager through the fake — spawn → write → resize → kill → onExit, all asserted — with no real process.

## What landed

```
server/src/terminal/pty.ts                  PtySpawner / PtyHandle / PtySpawnOptions / TerminalSize — no node-pty import
server/src/terminal/node-pty-spawner.ts     the real spawner; the only module in the repo that imports node-pty
server/src/terminal/platform-shell.ts       the shell + TERM/COLORTERM decisions, pure and injected
server/src/terminal/manager.ts              createTerminalManager(spawner) — one shell per project
server/src/terminal/manager.test.ts         10 tests, all through the fake
server/src/terminal/platform-shell.test.ts  the two pure decisions, tested without node-pty
server/src/testing/fake-pty.ts              the scripted fake spawner (test support, out of dist)
server/src/testing/fake-pty.test.ts         the fake's own control surface
server/package.json                         "node-pty": "1.1.0" (exact pin, server-only)
```

- **One door to node-pty.** The facade mirrors `sdk/provider.ts`: `pty.ts` carries the interface and
  imports nothing native, `node-pty-spawner.ts` is the only module that imports `node-pty`, and
  `fake-pty.ts` stands in everywhere else. `grep` over all three packages' sources: one declaration
  (`server/package.json`), one import (`node-pty-spawner.ts`).
- **Shell and environment are a pure decision, injected.** `platform-shell.ts` picks
  `powershell.exe` on win32 and `$SHELL`/`bash` on POSIX and composes `process.env` + `TERM` +
  `COLORTERM`, taking the platform and parent env as arguments — which is the only way to test that
  choice without importing the native module (the ticket's "never import node-pty in a test" rule).
- **`open` replaces, and exit reaps only the live entry.** `killAndForget` deletes the map entry
  *before* killing, so a handle that fires its own exit during the kill cannot reap the replacement
  `open` is about to install; `reap` notifies listeners only when the entry still names that handle.
  This is what makes "a reload gets a fresh shell" true in ticket 13 without a stale exit closing the
  newcomer's socket.
- **`TerminalManager` public surface** (what ticket 13 drives): `open(projectId, {cwd, cols, rows,
  onData})`, `write`, `resize`, `pause`, `resume`, `close`, `has`, `onExit`, `dispose`.
  (`TerminalSize` and the one-helper `withHandle` collapse in `manager.ts` came from the slice's
  review pass — see ticket 13's review section.)
- **`handleFlowControl: true` is the basic high-watermark**, decided by node-pty itself; the facade's
  `pause`/`resume` are the seam for a *client-side* backlog that this slice does not wire (the
  reasoning is in `pty.ts` and in ticket 13's review section).

## Known gaps

- **The real `spawn()` call has no automated test, by design** (spec-03's non-goal: no live-pty
  test). It is covered only by the manual smoke recorded below. Every automated test drives the
  scripted fake.
- **npm 11 gates install scripts and does not run node-pty's** (`npm warn install-scripts …`). It
  does not matter: node-pty ships prebuilds in the tarball, so the binding loads and a real ConPTY
  shell spawns without them. Verified directly (`require('node-pty').spawn` → a live
  `powershell.exe`). If a future node-pty bump ships without prebuilds, `npm install-scripts approve
  node-pty` is the missing step.
- Nothing else was deferred: no route, no `AppOptions` change and no `keyboard`-level extras — those
  belong to ticket 13, and the ticket's scope held exactly (the incoming diff touched only
  `server/package.json`, `package-lock.json`, `server/src/terminal/**`, `server/src/testing/**`).

## Evidence

```
npm run typecheck                      → clean (shared build + server + web tsc)
npm test                               → shared 7 passed | server 93 passed, 1 skipped | web 27 passed
npm run build --workspace @clodeck/server → clean; dist/terminal/* present, dist/testing/ absent
```
The single skip is ticket 03's pre-existing POSIX-only symlink case. No test needs a shell, an API
key or the network.

Manual smoke on the branch tip (not a test), against the real binding:
```
node -e "require('node-pty').spawn('powershell.exe', …)" → ConPTY shell starts, output received, killed cleanly
```
Merged into `clodeck/12-14-terminal` as `7d577d8` (branch `clodeck/12-server-terminal-seam` @
`a353472`), merged by a separate reviewer that re-read the checklist against the source and confirmed
the isolation claim by grep rather than by summary.
