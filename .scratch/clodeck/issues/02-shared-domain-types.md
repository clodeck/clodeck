# 02: Shared domain types (`@clodeck/shared`)

**What to build:** One shared TypeScript package that both `server` and `web` import, so the `Project` shape and the transport envelope are defined once and cannot drift between backend and frontend. The envelope and SDK message types are declared now (even though only `Project` is consumed this slice) so later transport work never re-models them.

**Blocked by:** 01

**Status:** resolved

- [x] `shared` exports `Project` and it type-checks when imported from both `server` and `web`.
- [x] `Project = { id: string; name: string; path: string }` — `id` = base64url(canonical absolute path), `name` = folder basename, `path` = canonical absolute path (display-only).
- [x] `ServerEvent` (server→client) is a discriminated union on `kind ∈ { 'sdk', 'approval_request', 'snapshot', 'stream_status', 'error' }` with `{ v, seq, ts, kind, projectId?, sessionId?, turnId?, payload }` and per-kind payload types.
- [x] `ClientMessage` (client→server) is a discriminated union on `type ∈ { 'send_prompt', 'interrupt', 'approval_response', 'set_permission_mode', 'resume' }` with `{ v, id, type, payload }`.
- [x] `SDKMessage` is a structural mirror of the `system` / `assistant` / `user` / `tool_progress` / `stream_event` / `result` subset, and `shared` has **no** dependency on `@anthropic-ai/claude-agent-sdk` (that stays server-only).
- [x] `shared` builds to `dist` with type declarations; strict mode holds with no `any` leaking into the shared contracts.

## What landed

```
shared/src/project.ts    Project (the domain entity)
shared/src/protocol.ts   PROTOCOL_VERSION, ServerEvent + payloads, ClientMessage + payloads
shared/src/sdk.ts        the SDK mirror: PermissionMode, SessionState, content blocks,
                         API messages, stream events, the six message families, SDKMessage
shared/src/index.ts      the public entry — `export *` from the three modules
```

- Both envelopes are `Base & (union)` so the common fields (`v/seq/ts/...`, `v/id`) are declared
  once while `kind` / `type` stay discriminated; the test switches over every member with a
  `never` default, so adding a kind or type breaks compilation where it must be handled.
- The mirror is deliberately **wider** than the SDK's own types (optional where the SDK is
  optional, `string` where the client never branches on a literal, open-ended where the SDK's set
  can grow) because the server assigns the real `SDKMessage` to it. Two consequences, both
  documented in `sdk.ts`: `UnknownContentBlock` keeps exotic API blocks assignable (so a literal
  `type` check pairs with a property guard), and `SDKSystemOtherMessage` widens `subtype` for
  `system` subtypes the client ignores.
- `session_state_changed`'s state and `snapshot.state` share one `SessionState` type; the init
  message's `permissionMode` and `set_permission_mode` share one `PermissionMode` — both mirror the
  SDK, so they live in `sdk.ts` and `protocol.ts` imports them.
- `snapshot.blocks` is `readonly SDKMessage[]`: the SDK sees no reason to invent a second
  conversation model before the history slice (wayfinder 06) defines one.
- `suggestions` / `updatedPermissions` are `readonly unknown[]` — the client only echoes them back
  ("Always allow"), and a structural `PermissionUpdate` mirror would be false precision.

## Evidence

```
npm run typecheck → all three packages clean (shared, server, web — web needs the web lib, server the node lib)
npm test          → shared 6 passed, server 3 passed, web 3 passed
grep -rnE ":\s*any\b|<any>|as any" shared/src → no matches
shared/dist       → index/project/protocol/sdk .js + .d.ts (+ maps); index.d.ts is the three re-exports
```

`Project` is imported (type-only) by the server's tests (`server/src/app.test.ts`) and by
`web/src/App.test.tsx`, so each consumer compiles against the built declarations.

**Not verifiable yet (by design):** assignability of the real `SDKMessage` to the mirror. The SDK is
not a dependency of this slice (it bundles a native binary), so the check lands with the chat bus,
where the server first narrows and assigns. The mirror is written to be assignable-safe in the
meantime; the risk is recorded here rather than hidden.
