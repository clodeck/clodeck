# 10: Web chat, streaming renderer, and approval modal

**What to build:** The chat stub becomes a live streaming chat surface over the `/ws` bus: tokens appear incrementally, tool activity is visible, and gated tools surface an approval modal.

**Blocked by:** 08

**Status:** resolved

- [x] A chat data seam opens a WebSocket to `/ws?projectId=…`, reconnects with backoff, rebuilds state from `snapshot` on (re)connect, and accumulates `sdk` events; control messages are typed from the shared `ClientMessage`.
- [x] Tokens appear incrementally: `stream_event` deltas accumulate into a text bubble, reconciled by complete `assistant` blocks.
- [x] The renderer maps `tool_use` → tool card, `tool_result` → collapsed, `thinking` → collapsible, `tool_progress` → "Using …", `result` → done + cost; `parent_tool_use_id` nests subagent frames, and unknown kinds are ignored.
- [x] An approval modal shows the tool's title/displayName/description and input, with Allow/Deny; the client answers with `approval_response` (Allow/Deny only for the MVP).
- [x] A composer sends `send_prompt`, and an interrupt action sends `interrupt`.
- [x] Sending a prompt while a turn is running surfaces the server's `turn_in_progress` error rather than double-driving the model.
- [x] Control messages are typed from the shared envelope, so a contract change breaks the client at compile time.

## What landed

```
web/src/chat/reducer.ts      applyServerEvent / applySdkMessage — the pure event → ChatView fold
web/src/chat/reducer.test.ts the fold's rules, asserted against real ServerEvent / SDKMessage frames
web/src/chat/useChat.ts      useChat(project) — the socket seam and the control messages
web/src/chat/ChatPanel.tsx   the transcript, composer, interrupt, error banner, approval modal
web/src/App.tsx              the Chat stub replaced; Terminal and Files stubs and the layout kept
web/vite.config.ts           the `/api` proxy kept; `/ws` added with `ws: true` to the same origin
```

The reducer's public surface (`web/src/chat/reducer.ts`):

```ts
emptyView(): ChatView
applyServerEvent(view: ChatView, event: ServerEvent): ChatView   // the fold, one ServerEvent at a time
applySdkMessage(view: ChatView, message: SDKMessage): ChatView   // exported so a live turn and a snapshot share one renderer
withUserPrompt(view: ChatView, text: string): ChatView           // the local optimistic bubble
dismissApproval(view: ChatView, requestId: string): ChatView
clearError(view: ChatView): ChatView
```

`ServerEvent` kinds `applyServerEvent` handles: `sdk`, `snapshot`, `approval_request`, `stream_status`, `error` — anything else returns the view unchanged. Inside `sdk`, `applySdkMessage` handles `system` (`init` / `status` / `session_state_changed`), `stream_event`, `assistant`, `user`, `tool_progress`, `result`; every other family, every unknown content-block type and every unknown block type is ignored (research 01 §3).

`ClientMessage`s sent — each built as `const message: ClientMessage = { v, id, type, payload }` so a contract change is a compile error, never a string literal: `send_prompt { prompt }`, `interrupt {}`, `approval_response ApprovalResponsePayload` (Allow / Deny only).

## Known gaps

- **No component or browser test.** The React layer — the rendering in `ChatPanel.tsx`, the `useChat` socket lifecycle in a live page, the approval modal's DOM, reconnect-with-backoff — is covered only by `typecheck` + `build` plus the reducer tests (which fold hand-built `ServerEvent` frames, i.e. the wire bytes, but never render). The spec puts browser-level e2e out of scope, but stated plainly: nothing that the DOM produces is asserted by a test.
- **A rejected prompt leaves its bubble.** `sendPrompt` appends the optimistic user bubble locally *and* sends `send_prompt`; when a turn is already running the server answers `error { code: 'turn_in_progress' }`, which the banner surfaces, but the bubble that was never accepted stays in the transcript.
- **An optimistic prompt can vanish on reconnect.** `snapshot` rebuilds the view from the server's complete `blocks` only, so a prompt sent locally but not yet echoed into a block is dropped by a snapshot that arrives before it lands.

## Evidence

```
npm run typecheck → clean (shared, server, web: tsc --project, no errors)
npm test          → shared: 7 passed (1 file) | server: 72 passed, 1 skipped (8 files) | web: 17 passed (2 files)
npm run build     → clean; vite: 26 modules transformed, dist/assets/index-*.js 239.75 kB (gzip 74.17 kB)
```

No test needs an API key or the network. `server/src/testing/fake-provider.ts` is the only provider the suite drives (the SDK itself is never loaded in a test), the socket tests use `app.listen({ port: 0 })` on loopback, and the one `fetch` in the tree is the client's `/api/projects` call, exercised through a stubbed `fetch` — never a live origin. The single skip is ticket 03's POSIX-only symlink-to-a-file case (`it.skipIf(win32)`), unrelated to this ticket.

What the implementer verified by hand, which I re-read the source to confirm:

- `useChat` opens `new WebSocket(socketUrl(project.id))` against `/ws?projectId=…` (the URL is resolved from the page and the scheme swapped to `wss:` on a TLS page), reconnects on any unexpected close with a doubling backoff (500 ms → 8 s), and folds every frame through `applyServerEvent` — so the `snapshot` the bus sends first rebuilds the whole view on each (re)connect.
- Every control message is annotated `: ClientMessage`, not assembled from hand-rolled string literals.
- The modal (`ApprovalDialog` in `ChatPanel.tsx`) renders `request.title ?? \`Claude wants to use ${request.toolName}\``, plus `displayName`, `description` and the JSON `input`, and answers `{ requestId, behavior: 'allow' | 'deny' }`.
- The composer sends `send_prompt`; the header's Interrupt button (disabled unless `view.state === 'running'`) sends `interrupt`; `errorTitle` maps `turn_in_progress` to "A turn is already running".

Manual checks on the integration tip `5f92f84`:

- `git show --stat a2d1a44` and `git show --stat 5f92f84` together touch only `web/src/App.tsx`, `web/src/chat/*` and `web/vite.config.ts`; `git diff f291cd5 a2d1a44 -- server/ shared/` is empty, so ticket 10 introduced nothing under `server/` or `shared/`. (The literal `git diff f291cd5 5f92f84 -- server/ shared/` is *not* empty — every line of it is ticket 09's already-merged session REST, which reached this branch through the `6c333cc` merge, not ticket 10.)
- `web/vite.config.ts` keeps the `/api` proxy and adds `/ws` with `ws: true` at the same `BACKEND_ORIGIN`.
- `web/src/App.tsx` keeps the Terminal and Files stubs and the two-column layout, replacing only the Chat stub.
