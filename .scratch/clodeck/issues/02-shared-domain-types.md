# 02: Shared domain types (`@clodeck/shared`)

**What to build:** One shared TypeScript package that both `server` and `web` import, so the `Project` shape and the transport envelope are defined once and cannot drift between backend and frontend. The envelope and SDK message types are declared now (even though only `Project` is consumed this slice) so later transport work never re-models them.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `shared` exports `Project` and it type-checks when imported from both `server` and `web`.
- [ ] `Project = { id: string; name: string; path: string }` — `id` = base64url(canonical absolute path), `name` = folder basename, `path` = canonical absolute path (display-only).
- [ ] `ServerEvent` (server→client) is a discriminated union on `kind ∈ { 'sdk', 'approval_request', 'snapshot', 'stream_status', 'error' }` with `{ v, seq, ts, kind, projectId?, sessionId?, turnId?, payload }` and per-kind payload types.
- [ ] `ClientMessage` (client→server) is a discriminated union on `type ∈ { 'send_prompt', 'interrupt', 'approval_response', 'set_permission_mode', 'resume' }` with `{ v, id, type, payload }`.
- [ ] `SDKMessage` is a structural mirror of the `system` / `assistant` / `user` / `tool_progress` / `stream_event` / `result` subset, and `shared` has **no** dependency on `@anthropic-ai/claude-agent-sdk` (that stays server-only).
- [ ] `shared` builds to `dist` with type declarations; strict mode holds with no `any` leaking into the shared contracts.
