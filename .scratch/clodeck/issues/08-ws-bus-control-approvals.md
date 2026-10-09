# 08: WebSocket event bus, control messages, and approvals

**What to build:** A JSON WebSocket bus at `/ws` carries SDK stream events to the browser and accepts control messages (send_prompt, interrupt, approval_response, set_permission_mode, resume). Each connection is bound to one project, a per-project run state tracks the active turn, and gated tools round-trip through an approval modal via the provider's `canUseTool`.

**Blocked by:** 07

**Status:** resolved

- [x] `/ws` is registered on the same Fastify app — `buildApp` now takes `{ projects, provider }` — and a connection is bound to a project via `?projectId=`.
- [x] On upgrade, the project id is decoded and re-validated against the allowlist; a non-allowlisted id closes the socket with an error.
- [x] `send_prompt` on an idle project mints a `turnId`, emits `stream_status: turn_started`, streams each SDK message as an `sdk` event (monotonic per-connection `seq`), and ends with `result` → `stream_status: turn_ended`; the `session_id` is captured for "continue latest".
- [x] `send_prompt` while a turn is running is rejected with `error { code: 'turn_in_progress' }`.
- [x] `interrupt` stops the active turn and emits `stream_status: interrupted`; `set_permission_mode` calls the run's `setPermissionMode`.
- [x] `resume` sets the project's resume target (`continue` → `continueLatest`; `{ sessionId, fork? }` → resume/fork) for the next send, and does not itself send a prompt.
- [x] A gated tool (including `AskUserQuestion`) emits `approval_request`, and the matching `approval_response` resolves it; pending approvals are re-sent as `snapshot.pendingApprovals` on reconnect.
- [x] A reconnect receives a `snapshot` with run state, complete blocks (buffered deltas collapsed), pending approvals, and `lastSeq`.
- [x] Every event is built from the shared `ServerEvent` envelope (kind, payload, seq, ts, projectId, sessionId, turnId).
- [x] The bus is tested end-to-end against the fake provider over a local socket: stream ordering, turn-in-progress rejection, interrupt, approval round-trip, snapshot/reconnect, resume target, and non-allowlisted rejection.

## What landed

```
server/src/ws/bus.ts            registerWsBus(app, { projects, turns }) — socket binding,
                                id re-validation, frame dispatch and the seq/ts emitter
server/src/ws/turn-manager.ts   createTurnManager(provider) — per-project run state,
                                turn lifecycle, approvals, resume target
server/src/ws/client-message.ts parseClientMessage(raw) — untrusted wire JSON -> typed intent
server/src/ws/events.ts         EventDraft = ServerEvent minus { seq, ts } (the transport
                                stamps those at send time)
```

`buildApp`'s signature is unchanged (`{ projects, provider }`); `app.ts` registers the bus on the
same Fastify instance, so `main.ts` and the tests reach `/ws` with no second server. The run state is
`createTurnManager(provider)`, one `ProjectRun` per project id, in memory only.

**The exact event sequence for one turn** (fresh connection, `seq` per connection from 1):

```
1  snapshot          { state, blocks, pendingApprovals, lastSeq: 0 }     ← always first frame
2  stream_status     turn_started  (turnId minted here; sessionId not yet known)
3… sdk               one per mirrored SDKMessage, in order  (session_id captured from the init)
   sdk               the result message itself is streamed like any other
   stream_status     turn_ended    (emitted right after the result arrives)
```

`interrupt` → `run.interrupt()` → `stream_status: interrupted` (same turnId); `set_permission_mode`
→ `run.setPermissionMode(mode)` and no event of its own; a gated tool parks the run and broadcasts
`approval_request`, and the matching `approval_response` resolves the parked promise (state returns
to `running`, or `idle` if there is no run). A send while `status !== 'idle'` is rejected with
`turn_in_progress` and a second `query()` is never made.

**Error codes** (all present in the code): `unknown_project`, `invalid_message`,
`turn_in_progress`, `no_active_turn`, `internal`.

**Socket binding and allowlist re-validation.** `/ws?projectId=<id>` → `readProjectId` →
`ProjectDiscovery.resolveProject(id)`, which is `base64url` decode (charset-checked first, so a
degenerate buffer can never become a path) → `canonicalizeInsideRoot` → `stat().isDirectory()`.
Anything null — bad id, `..`, symlink escape, missing path, a file — gets an
`error { code: 'unknown_project' }` frame and `socket.close(1008, 'unknown_project')`; the socket is
never opened, and a connection that names no project at all is treated the same. Decoding an id is
never authorization: the door re-checks the allowlist every time.

**The fake-provider extension is purely additive.** `holdRuns`/`failRuns` options, `releaseRuns()`,
an internal one-shot `Gate`, and a private `streamMessages(queue, ending)` signature. Everything
ticket 07 documented (`queryInputs`, `waitForQueryInput`, `permissionModes`, `waitForPermissionMode`,
`interruptCount`, `waitForInterrupt`, `requestApproval`, and `createFakeProvider({ messages, sessions,
sessionMessages })`) is unchanged in name and shape. A scripted turn otherwise drains inside a
microtask, so `holdRuns` is what makes the bus's busy paths (`turn_in_progress`, `interrupt`) — and
the reconnect/snapshot state — reachable deterministically; `failRuns` reaches the `internal` error
path.

`bus.ts` names the `WebSocket` type through a **type-only** import from `ws`, and inlines the OPEN
constant (`1`) rather than importing the runtime value, so the bus carries no runtime dependency on
`ws`: the built `dist/ws/bus.js` imports only `@fastify/websocket` and `@clodeck/shared`, and `ws`
is a `devDependency` (`@fastify/websocket` is the production dependency).

## Known gaps

Neither of these blocks the ticket; both are honest holes in coverage, not in behavior.

- **`AskUserQuestion` has no dedicated test.** It is deliberately served by the same `canUseTool`
  path as every other tool — `canUseTool: (request) => park(state, request)` is tool-name-agnostic,
  so a gated `AskUserQuestion` round-trips identically — but only a `Bash`-named approval is
  exercised end-to-end, so the checkbox's "including `AskUserQuestion`" clause rests on the
  callback being generic, not on a test that names it.
- **Two sockets on one project are documented but not tested.** `turn-manager.ts` states that two
  connections bound to the same project share one `ProjectRun` (same blocks/state/approvals, each
  with its own `seq`), and the code supports it, but the tests never open two sockets concurrently —
  the reconnect test closes the first socket before the second connects.

## Evidence

```
npm run typecheck → clean (shared, server, web; no diagnostics)
npm test          → shared: 7 passed (7); server: 66 passed | 1 skipped (67); web: 2 passed (2)
npm run build     → clean (tsc x3; web vite "✓ built in 99ms")
```

No test needs an API key or the network: the bus tests drive `buildApp` with the fake provider over
`app.listen({ port: 0, host: '127.0.0.1' })` and a real `ws` client against `ws://127.0.0.1:<port>`
(loopback only); a grep of `server/src/**/*.test.ts` for `ANTHROPIC_API_KEY`/`apiKey`/`fetch(`/`npx`
returns nothing. The one skipped test is ticket 03's POSIX-only symlink case.

Manual checks run against the integration tip (`d0be777`):

- `git show --stat 1d495ab` touches `package-lock.json`, `server/package.json`, `server/src/app.ts`,
  `server/src/discovery.ts` (+ its test), `server/src/testing/fake-provider.ts` (+ its test),
  `server/src/ws/{bus,turn-manager,events,client-message}.ts` and `bus.test.ts`. **Nothing in
  `shared/` or `web/`** — `git diff 25f401b HEAD -- shared/src/protocol.ts` is empty
  (byte-identical to the pre-08 tip).
- `git diff 25f401b HEAD -- server/src/testing/fake-provider.ts` adds only the options, `releaseRuns`,
  the `Gate` helper and the `streamMessages` parameter; no existing member changed name or shape.
- `stream_event` is excluded from `snapshot.blocks` (`if (message.type !== 'stream_event')
  state.blocks.push(message)`) while every other family is retained; a fresh connection's first frame
  is always `snapshot` with `seq: 1` and `payload.lastSeq: 0`.
- `ws` is a `devDependency`; `@fastify/websocket` is a production dependency; no non-test source
  imports `ws` at runtime (only the type-only import noted above).
