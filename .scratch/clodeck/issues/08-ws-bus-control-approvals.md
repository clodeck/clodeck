# 08: WebSocket event bus, control messages, and approvals

**What to build:** A JSON WebSocket bus at `/ws` carries SDK stream events to the browser and accepts control messages (send_prompt, interrupt, approval_response, set_permission_mode, resume). Each connection is bound to one project, a per-project run state tracks the active turn, and gated tools round-trip through an approval modal via the provider's `canUseTool`.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] `/ws` is registered on the same Fastify app — `buildApp` now takes `{ projects, provider }` — and a connection is bound to a project via `?projectId=`.
- [ ] On upgrade, the project id is decoded and re-validated against the allowlist; a non-allowlisted id closes the socket with an error.
- [ ] `send_prompt` on an idle project mints a `turnId`, emits `stream_status: turn_started`, streams each SDK message as an `sdk` event (monotonic per-connection `seq`), and ends with `result` → `stream_status: turn_ended`; the `session_id` is captured for "continue latest".
- [ ] `send_prompt` while a turn is running is rejected with `error { code: 'turn_in_progress' }`.
- [ ] `interrupt` stops the active turn and emits `stream_status: interrupted`; `set_permission_mode` calls the run's `setPermissionMode`.
- [ ] `resume` sets the project's resume target (`continue` → `continueLatest`; `{ sessionId, fork? }` → resume/fork) for the next send, and does not itself send a prompt.
- [ ] A gated tool (including `AskUserQuestion`) emits `approval_request`, and the matching `approval_response` resolves it; pending approvals are re-sent as `snapshot.pendingApprovals` on reconnect.
- [ ] A reconnect receives a `snapshot` with run state, complete blocks (buffered deltas collapsed), pending approvals, and `lastSeq`.
- [ ] Every event is built from the shared `ServerEvent` envelope (kind, payload, seq, ts, projectId, sessionId, turnId).
- [ ] The bus is tested end-to-end against the fake provider over a local socket: stream ordering, turn-in-progress rejection, interrupt, approval round-trip, snapshot/reconnect, resume target, and non-allowlisted rejection.
