# 04 — Backend transport and API shape

Type: grilling
Status: resolved
Blocked by: 01

## Question

WebSocket vs SSE for streaming chat and tool events from the SDK to the frontend, and what backend API shape (endpoints + event protocol) connects the SDK and the per-project terminal to the React client?

## Answer

**Verdict: WebSocket (JSON) for the chat/tool event stream — one multiplexed bus per browser session — plus REST for request/response mutations.** The terminal keeps its own raw-byte WebSocket (ticket 02). SSE is rejected.

### 1. Transport (chat/tool stream)

- **WebSocket (JSON), a socket separate from the terminal's raw-byte WS.** One mechanism (WS) used twice, two distinct sockets: the terminal socket carries raw bytes to `@xterm/addon-attach`; the chat socket carries framed JSON events.
- **Why not SSE:** (a) `ws` is already a dependency from the terminal; (b) control signals (send, `interrupt`, approve/deny/allow-with-edits, `AskUserQuestion` answers, set permission mode) are frequent and bidirectional — natural on WS, on SSE they need a parallel POST + correlation id; (c) SSE's headline advantages (auto-reconnect, `Last-Event-ID` replay) are largely moot here because the SDK owns session/resume state — the transport is a live forwarder, not the source of truth; (d) the visual reference (claudecodeui) uses WS.
- **Rejected:** one unified WS carrying both JSON chat and raw terminal bytes (framing the two together is messy; the attach addon expects raw bytes).

### 2. Wire protocol — thin normalized envelope, passthrough payload

Server→client:

```jsonc
{ "v":1, "seq":n, "ts":"…", "kind":"…",
  "projectId":"…", "sessionId":"…", "turnId":"…", "payload":{…} }

// kind ∈ { "sdk", "approval_request", "snapshot", "stream_status", "error" }
//   sdk              → payload = raw SDKMessage, unmodified (payload.type is the SDK's own discriminator)
//   approval_request → payload = { requestId, toolUseID, toolName, input, title, displayName, description, suggestions, defaultToNo }
//   snapshot         → payload = { state: idle|running|requires_action, blocks:[…], pendingApprovals:[…], lastSeq }
//   stream_status    → payload = { status: turn_started|turn_ended|interrupted }
//   error            → payload = { code, message, turnId? }
```

Client→server (control):

```jsonc
{ "v":1, "id":"…", "type":"send_prompt|interrupt|approval_response|set_permission_mode|resume", "payload":{…} }
// resume.payload = { mode:"continue" } | { sessionId, fork? }
```

- `seq` is a monotonic **per-connection** counter (reset on reconnect), used for ordering/gap detection only — not global.
- **Why an envelope at all:** `canUseTool` is a *callback*, not an `SDKMessage`, so `approval_request` has no home in the SDK's message union — a backend-defined namespace is required regardless. `v` decouples the client from the fast-moving SDK `d.ts`. The SDK message stays intact as `payload` (no field-by-field re-modeling) so this is a translation seam, not a translation layer.
- `stream_status` is kept minimal (turn_started/turn_ended/interrupted) because turn start is a *backend* event (not an SDK message) and a `query()` that throws before emitting anything still needs a signal. Droppable if `system`/`session_state_changed` proves sufficient.
- `approval_request` fields map 1:1 to the `CanUseTool` callback (research 01 §5); `approval_response` returns `{ behavior:'allow'|'deny', updatedInput?, updatedPermissions?, message? }` (allow-with-edits echoes a modified `updatedInput`).

### 3. Topology

- **One multiplexed JSON WS per browser session** (the event bus); every event tagged `projectId` + `sessionId` + `turnId`. Switching projects doesn't churn the socket; concurrent runs across projects (implied by keep-running) multiplex cleanly.
- Terminal sockets stay **per-terminal** (raw bytes, ticket 02) — unaffected.

### 4. Concurrency

- **One active turn per project.** A `send_prompt` while a turn is running is rejected ("turn in progress"); the user interrupts first. Multiple projects may run in parallel.
- The backend mints a `turnId` per `query()` call; all events carry `projectId` + `sessionId` + `turnId` for routing.

### 5. Turn start & control

- `send_prompt`, `interrupt`, `approval_response`, `set_permission_mode`, `resume`/`fork`/`continue` are all **in-band WS control messages** (approvals need in-band correlation with the pending `canUseTool` promise anyway).
- REST is reserved for request/response CRUD only.

### 6. Disconnect / reconnect

- **Keep running + buffer + reattach (60s idle timeout).** On socket drop the backend keeps the `Query` running and buffers; on reconnect the client gets an immediate `snapshot` (state + complete message blocks of the active session + outstanding approvals + `lastSeq`), then live events continue. Buffered deltas from the disconnect gap are **collapsed to complete blocks** (no replay of thousands of `stream_event`s). If the client doesn't reattach within 60s, the backend `interrupt()`s to bound token spend.
- **Rejected:** REST-get-then-attach (a race window between the GET and the WS attach loses events).

### 7. REST surface

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — auth (later ticket; listed for completeness)
- `GET /api/projects` — project discovery (ticket 05)
- `GET /api/projects/:id/sessions`, `GET /api/projects/:id/sessions/:sid/messages` — history/resume
- `GET|PUT|POST|DELETE /api/projects/:id/files/**` — file drawer ops: list/read/create/rename/move/delete/upload/download (ticket 03)
- `POST /api/projects/:id/terminals` + WS `/ws/terminals/:id` (raw bytes) + resize frame — terminal (ticket 02)
- WS `/ws` — the multiplexed JSON event bus

Backing research: [01 — Agent SDK session/streaming/resume](../research/01-agent-sdk-session-streaming.md), [02 — Web terminal (PTY)](../research/02-web-terminal-pty.md).
