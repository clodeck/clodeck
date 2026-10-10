# 13: Terminal transport — raw-byte `/ws/terminal` and resize REST

**What to build:** A browser can open a raw WebSocket to the selected project's terminal, type into it and see bytes stream back, and resize the pty by posting a size. The project id is re-validated through the allowlist before any process spawns, so a non-allowlisted id is refused, never opened.

**Blocked by:** 12

**Status:** resolved

- [x] `/ws/terminal?projectId=…` is registered on the same Fastify instance `buildApp` returns (raw bytes, no JSON).
- [x] The project id is resolved through the allowlist seam; a non-allowlisted id closes the socket before any pty spawns.
- [x] On connect a pty spawns at the project's canonical `cwd`; bytes client→server reach the pty; pty output streams to the socket; closing the socket kills the pty and cleans it up.
- [x] `POST /api/projects/:id/terminal/size` resizes the project's current pty (`200`), answers `404` when there is no terminal, and `400` on a malformed body.
- [x] End-to-end tests drive the raw socket and the resize endpoint against the fake spawner (no real shell).

## What landed

```
server/src/terminal/transport.ts   registerTerminalSocket + registerTerminalSizeRoute — the route, ownership, resize
server/src/terminal/transport.test.ts  14 e2e tests: raw socket on a loopback ephemeral port + app.inject
server/src/app.ts                  third seam `spawner: PtySpawner`; @fastify/websocket registered once at the root
server/src/ws/bus.ts               dropped its own plugin registration (the root registers it now)
server/src/main.ts                 injects createNodePtySpawner()
server/src/testing/dev-fake.ts     injects the fake spawner (see Known gaps)
server/src/{app,sessions,ws/bus}.test.ts  inject the fake spawner — mechanical, as the provider was in slice 02
server/src/ws/frames.ts            WS_OPEN + textOf, now stated once (review pass; see below)
```

- **Raw bytes, and `protocol.ts` is not involved.** `socket.on('message')` → `terminals.write`, and
  the shell's `onData` → `socket.send` — string frames, no `JSON.parse`/`stringify`, no envelope. The
  module imports nothing from `@clodeck/shared`; the frozen envelope is untouched by this slice.
- **The allowlist is checked before a process exists.** `resolveProject(rawId)` returning `null`
  (a non-allowlisted id, or no id at all) closes the socket with `1008` and returns — no
  `spawner.spawn` call, which the tests assert by length, not by absence of a crash.
- **Ownership is the reload-safety mechanism.** `owners: Map<projectId, WebSocket>` is claimed
  *before* `terminals.open` (which replaces the previous handle, killing it). `message`, `close` and
  the `onData` sink all no-op unless the caller is the current owner, so a socket left open while a
  newer one opened for the same project can neither feed bytes to nor kill the newer shell — the naive
  `close(projectId)` would do both. That test is load-bearing: it fails against the naive version.
- **Resize is REST under `/api`** — `/api/projects/:id/terminal/size`, so the future auth hook from
  wayfinder 07 covers it with no extra work. `resolveProject` → unknown project `404`; malformed body
  `400` (`cols`/`rows` must be positive integers, checked before the terminal is consulted); no open
  terminal `404`. `200` answers `{ ok: true }` (the ticket fixes only the status).
- **Exit and disconnect are guarded.** `onExit` closes the owner (or nothing, if the client already
  left); `sendQuietly`/`closeQuietly` check `readyState` and swallow throws, so a socket closing
  mid-send cannot take the transport down.

## Code review (the whole slice)

The slice was reviewed on the integration branch along two axes (Standards, Spec). Both reports are
recorded here because the *declines* are design decisions a later session must not undo blind.

**Fixed (one pass, branch `clodeck/terminal-review-fixes` @ `61115ee`, merged as `be87aa19`):**

1. `WS_OPEN` and `textOf` were duplicated byte-for-byte between `ws/bus.ts` and `terminal/transport.ts`
   → both now import them from `server/src/ws/frames.ts` (one definition each, verified by grep).
2. `manager.ts`'s `write`/`resize`/`pause`/`resume` were the same four-line shape four times → one
   private `withHandle`; public surface and every boolean unchanged.
3. `pty.ts`'s comment claimed the transport "wires xterm.js backpressure" — it does not. Comment
   corrected (and one added at `handleFlowControl: true` in the spawner) instead of building the
   wiring; see declines.
4. The `{cols, rows}` pair now has a name — `TerminalSize` — in `pty.ts`/`manager.ts`/`transport.ts`
   and mirrored in `web/src/terminal/transport.ts`.

The refactor pass changed no behaviour: the pre- and post-pass test counts are identical, and its
reviewer audited every test hunk line by line (four call-site shape changes total — two in
`manager.test.ts`, two in `web/src/terminal/transport.test.ts`; no expectation deleted, loosened or
skipped).

**Declined on purpose — do not "fix" these without new information:**

- **Client-side flow control is not wired.** The spec's route prose asks for basic backpressure, and
  that is present at the level node-pty provides it (`handleFlowControl: true`); linking the *client's*
  xterm backlog to `pause()`/`resume()` needs a framed PAUSE/RESUME channel, which the same spec puts
  out of scope ("Flow-control-e pishrafte (ttyd-style PAUSE/RESUME framing) … az MVP khareje").
- **`TerminalManager.dispose()` has no shutdown hook.** `main.ts` has no graceful shutdown at all;
  adding one is a separate slice, not a fix inside this one.
- **`notFound` is not shared with `sessions.ts`.** The two 404s carry deliberately different messages
  ("no allowlisted project matches this id" vs "no terminal is open for this project"), and
  `sessions.ts` is outside this slice.
- **`@xterm/addon-fit` and the web `transport.test.ts` stay.** Both are deliberate; see ticket 14.

## Testing Decisions (a)–(h)

All eight covered by `transport.test.ts`: (a) spawn `cwd` = canonical project path; (b) client bytes →
`handle.write`; (c) `handle.onData` → socket; (d) close → `kill` + entry gone (asserted by a following
`404`); (e) shell `onExit` → socket closed; (f) resize `200`/`404`/`400`; (g) non-allowlisted and
id-less → `1008` with `spawner.spawns` empty; (h) reconnect → a fresh pty, never a reused handle.

## Known gaps

- **`npm run dev:fake` gives a terminal with no real shell.** `dev-fake.ts` injects the fake spawner
  (consistent with the fake provider beside it), so the panel connects and does nothing. For a real
  shell by hand use `npm run dev` — the Anthropic key is only needed when a prompt is actually sent,
  which the terminal never does.
- **`dispose()` is unexercised outside tests**, per the decline above.
- **The opening spawn is a fixed 80×24**; the client pushes its real size on open (ticket 14). A
  client that never connects leaves an 80×24 shell, which is what you want anyway.
- Client-side flow control, caps, idle timeout and multi-terminal remain out of scope, as ticketed.

## Evidence

```
npm run typecheck                      → clean (shared + server + web)
npm test                               → shared 7 | server 107 passed, 1 skipped | web 27
npm run build --workspace @clodeck/server → clean; dist/testing/ still absent
git rev-parse 9a9e05c:shared/src/protocol.ts = git rev-parse HEAD:shared/src/protocol.ts (659a99b3…, unchanged)
```
Line counts moved 93 → 107 server tests (14 new), none of them needing a shell or a network.

By-hand end-to-end against the **real** spawner on the integration tip (`be87aa19`, a temp
`PROJECTS_ROOT` with one project, `app.listen({ port: 0 })`, a raw `ws` client) — the only check in
this slice that forks a real shell:

```
ws://…/ws/terminal?projectId=<non-allowlisted>  → close 1008, no process
ws://…/ws/terminal?projectId=<alpha>  send "echo CLODECK_MARKER_9\r"
                                                → a real PowerShell echoed the marker back through the socket
POST /api/projects/<alpha>/terminal/size {cols:100,rows:30}  → 200
POST …/<non-allowlisted>/terminal/size                        → 404
POST …/<alpha>/terminal/size {cols:"wide",rows:30}            → 400
```
(node-pty's ConPTY console-list helper prints an `AttachConsole failed` trace to stderr in this
environment; it is that helper child, not the transport, and the run succeeds.)

Merged as `7f62321` (branch `clodeck/13-terminal-transport` @ `b90fc8f`); the merge reviewer
re-derived the checklist from the source, re-ran the suite, and independently re-drove the socket and
the resize endpoint against the fake before merging.
