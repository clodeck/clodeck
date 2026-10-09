# 06 — Session ↔ Project data model & persistence

Type: grilling
Status: resolved
Blocked by: 01, 04, 05

## Question

How do we model sessions against projects, where does session state live, and how does resume-by-id work? Specifically: (a) is the SDK's on-disk transcript store (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) the single source of truth, or do we keep our own session store? (b) what is the relationship between a *session* (SDK `session_id`) and a *turn* (04's `turnId`)? (c) new-vs-continue semantics — when the user opens a project or sends a prompt, does it start fresh or resume, and how does the user get back to a past session? (d) what do `GET /api/projects/:id/sessions` and `GET /api/projects/:id/sessions/:sid/messages` return?

## Answer

**Verdict: the SDK's on-disk transcript store (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) is the single source of truth — the backend adds no session database.** A *session* is the SDK `session_id` (one resumable conversation, persisted, spanning many turns); a *turn* is 04's `turnId` (one `query()` call, backend-minted, ephemeral). History is read back through the SDK's `listSessions()` / `getSessionMessages()` helpers and normalized to a stable API shape. Empty (unsent) chats are client state, not sessions.

### 1. Source of truth

- **SDK transcript store only.** Sessions live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The backend reads history with `listSessions({ dir: cwd })`, `getSessionMessages(sessionId, { dir })`, `getSessionInfo(...)`, and writes a title with `renameSession(...)`. There is no second source of truth and no schema to drift.
- **Why not our own store:** the SDK already persists per-cwd `title` (customTitle or summary/firstPrompt), `lastModified`, `createdAt`, `tag`, `gitBranch` — everything a session picker needs. Mirroring into SQLite/JSON duplicates state and invites sync bugs, for zero single-user benefit. The prototype's own glossary already encodes this ("Transcript … not the source of truth; the jsonl on disk is").
- **Growth seam:** an own store (and the SDK's `sessionStore` mirror adapter) is the future seam for cross-host or multi-user scoping — the same seam as 05 §7. Not adopted in MVP.

### 2. Session vs turn

- **Session** = one resumable conversation bound to a project's `cwd`; identity is the **SDK `session_id`**; it spans many turns and is persisted. Multiple sessions exist per project (history).
- **Turn** = one `query()` invocation (one user send → one agent loop → one `result`); identity is **04's `turnId`**, minted by the backend, ephemeral, never persisted, used only to route live-bus events.
- **API session id = the SDK `session_id`** — no parallel id. `resume`/`listSessions`/`getSessionMessages` all take this same id. "One active turn per project" (04) is consistent with "many sessions per project, one running turn at a time".

### 3. New vs continue

- **Default fresh.** Opening a project shows an empty chat; no automatic resume. "New session" clears chat state and the resume target.
- **Resume is explicit** — picking a past session in the sidebar loads its transcript, and subsequent sends resume it (`resume: sessionId`).
- **"Continue latest" is a one-click affordance** backed by `continue: true` (needs no stored id). "Remember the last session per project" is a per-user preference kept **client-side (localStorage)** if desired, never server persistence.

### 4. Session list — `GET /api/projects/:id/sessions`

```jsonc
{ "sessions": [
  { "id": "<session_id>", "title": "<…>", "createdAt": "…", "lastModified": "…", "tag": "…?" }
] }
```

- Wrapped (`{ sessions: [...] }`), consistent with 05's `{ projects: [...] }`.
- `title` fallback: `customTitle` (set by `renameSession`) → `summary` → `firstPrompt` → `"Untitled"`.
- Ordered `lastModified` desc (recent first) — the SDK's order; no separate server sort.
- `id` is the SDK `session_id`. Fields the UI doesn't need yet (`fileSize`, `cwd`, `gitBranch`) are omitted — adding them later is a normalization change, not a model change.

### 5. Transcript — `GET /api/projects/:id/sessions/:sid/messages`

```jsonc
{ "messages": [ { "role":"user"|"assistant", "content":[…], "toolUseId"?, "parentToolUseId"? } ] }
```

- **Normalized to the same message shape the live renderer consumes** (01 §3: `role`, `text`/`tool_use`/`thinking` content blocks, `tool_result`, `parent_tool_use_id`) — one render path for history and live.
- **Complete blocks only** — history is static; there are no `stream_event` deltas. Streaming is a live-turn concern only.
- **No pagination in MVP** — the full transcript (bounded by session length).

### 6. Persistence & the physical location of state

- **No server-side session database.** Running state (`idle`/`running`/`requires_action`) is in-memory, surfaced via 04's live bus + snapshot, never persisted. "Last active session per project" is client `localStorage`.
- **The SDK store location must persist:** `~/.claude` (or `CLAUDE_CONFIG_DIR`) is a Docker volume, so transcripts survive container recreation. This is the physical "where session state lives".
- **`sessionStore`** (mirror to a backend store) is the future seam for cross-host / multi-user; not adopted now (05 §7).

### 7. Empty sessions

- A fresh chat before the first send is **client state, not a session**: no `session_id`, no file, no row. The session comes into existence at the first `query()` — the `session_id` appears on the init `system` message.
- "New session" = clear chat state + clear the resume target; nothing is written to disk until the first send. Resume is therefore only meaningful for sessions that have actually been sent.

Backing: [01 — Agent SDK session/streaming/resume](01-agent-sdk-session-streaming.md) (session_id, resume/continue/fork, transcript location, `listSessions`/`getSessionMessages`), [04 — Backend transport and API shape](04-backend-transport.md) (`turnId`, session endpoints, one active turn per project), [05 — Project discovery](05-project-discovery.md) (project = cwd; multi-user seam).
