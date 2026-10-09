# 07: SDK provider facade, session types, and fake

**What to build:** The SDK sits behind one provider interface — `query`, `listSessions`, `getSessionMessages` — so the rest of the server depends on shared types, and automated tests drive a scripted fake with no API key or network. The session-history types (`SessionSummary`, `SessionMessage`) are declared in shared, and a real provider implementation normalizes SDK history to them.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A `SdkProvider` interface exposes `query` (an async stream of mirrored SDK messages plus `interrupt()`/`setPermissionMode()`), `listSessions`, and `getSessionMessages`, all in terms of shared types.
- [ ] `SessionSummary` (`{ id, title, createdAt?, lastModified?, tag? }`) and `SessionMessage` (`{ role, content: ContentBlock[], toolUseId?, parentToolUseId? }`) are declared in shared and re-exported from the shared entry point.
- [ ] The real provider imports the SDK only inside the server, streams mirrored messages through the narrowing function, and normalizes SDK session info to `SessionSummary` (title fallback `customTitle → summary → firstPrompt → "Untitled"`) and SDK messages to `SessionMessage`.
- [ ] `query()` runs with `includePartialMessages: true`, `permissionMode: 'default'`, `allowedTools: ['Read','Glob','Grep']` (read-only auto-approve; everything else via `canUseTool`), `settingSources: ['project']`, and default `env`; the server never handles the API key (the SDK reads it from the environment).
- [ ] A scripted fake provider (in test support, not shipped) streams a pre-written queue of mirrored SDK messages and returns canned `listSessions`/`getSessionMessages`.
- [ ] Every automated test runs against the fake provider — none requires a key or network.
