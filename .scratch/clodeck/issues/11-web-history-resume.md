# 11: Web history, resume, and continue-latest

**What to build:** The client lists past sessions per project, opens a transcript, and resumes a specific session (or the latest one) into the live chat, with reload and reconnect recovery.

**Blocked by:** 09, 10

**Status:** resolved

- [x] A session data seam lists sessions and loads a transcript via the history REST endpoints.
- [x] A per-project session list shows past conversations with readable titles.
- [x] Opening a session renders its transcript (complete blocks, same renderer as live).
- [x] A resume affordance targets a specific session id (optional fork), and a "continue latest" affordance resumes the most recent session.
- [x] Resuming sets the target for the next send rather than sending a prompt itself; the resumed turn renders in the live chat.
- [x] A browser reload does not lose the session, and a dropped socket recovers to the current state (snapshot + reconnect).

## What landed

```
web/src/chat/useSessions.ts      useSessions(project) — the history seam (list + transcript), shaped like useProjects
web/src/chat/SessionHistory.tsx  SessionBrowser (the list + "Continue latest") and TranscriptPanel (read-only)
web/src/chat/EntryView.tsx       the one transcript renderer, extracted so live and history mount the same component
web/src/chat/reducer.ts          fromSessionMessages / applySessionMessage / withResumeTarget; ChatView.resumeTarget
web/src/chat/reducer.test.ts     the history fold and the resume target, asserted against the live path
web/src/chat/useChat.ts          the `resume` control message; ChatController.resume(target)
web/src/chat/ChatPanel.tsx       the History toggle, the resume banner, and the transcript/live switch
```

The reducer's public surface added (`web/src/chat/reducer.ts`):

```ts
fromSessionMessages(messages: readonly SessionMessage[]): ChatView      // fold a stored transcript
applySessionMessage(view: ChatView, message: SessionMessage): ChatView  // one stored turn
withResumeTarget(view: ChatView, target: ResumePayload): ChatView       // mirror an armed resume
```

plus `ChatView.resumeTarget: ResumePayload | null`, and `ChatController.resume(target: ResumePayload)` in `useChat`.

- **One renderer, not two.** `fromSessionMessages` replays each stored `ContentBlock` through the exact
  `applyAssistantBlock` / `applyUserBlock` the live fold uses (text, thinking, tool_use → card,
  tool_result → collapsed, `parent_tool_use_id` → nesting), and `EntryView` is imported by both
  `ChatPanel`'s live transcript and `SessionHistory`'s read-only one. The equivalence is pinned by a
  test: the history fold and the live fold are entry-for-entry identical for the same conversation, and a
  reconnect `snapshot` rebuilds the same entries as the transcript.
- **The `resume` control message.** Built as `const message: ClientMessage = { v, id, type: 'resume', payload }`
  (a contract change is a compile error), where the payload is the shared
  `ResumePayload = { mode: 'continue' } | { sessionId: string; fork?: boolean }` (`shared/src/protocol.ts`).
  `useChat.resume` mirrors the target into the view and sends the frame; it **never calls `sendPrompt`**, so
  the resumed turn starts on the next real send. "Continue latest" sends `{ mode: 'continue' }`; a row's
  Resume sends `{ sessionId }`; the transcript panel's fork sends `{ sessionId, fork: true }`.
- **The target, represented and cleared.** Server-side `TurnManager` holds `state.resume: ResumePayload |
  undefined` per project (in memory); `setResumeTarget` arms it and the next `send_prompt` reads *and clears*
  it before querying (`resume` / `forkSession`, or `continueLatest` for `{ mode: 'continue' }`). A
  `send_prompt` rejected with `turn_in_progress` returns before that line, so nothing is consumed. Client-side
  the reducer mirrors it as `ChatView.resumeTarget` (the banner) and clears it when the bus emits
  `stream_status: turn_started` — the bus's own signal that it consumed the target — while a rejected send
  leaves it in place, matching the server.

## Known gaps

- **No way to cancel an armed resume.** The protocol carries no "clear the target" message, so once `resume`
  is sent the only thing that drops the target is a send that consumes it. The banner states what the next
  message will continue and there is no Cancel affordance.
- **A browser reload loses the banner.** `SnapshotPayload` carries no resume target, so a reloaded client
  rebuilds with `resumeTarget: null` while the server's in-process target survives — the next send still
  resumes, but the user is no longer told. Fixing it needs a snapshot/protocol change, which is out of this
  slice.
- **Resume while the socket is not `OPEN` silently no-ops while the banner still shows.** `useChat.resume`
  sets the view first, then hands the frame to `send`, which drops anything when `readyState !== OPEN`; the
  client's banner and the server's target can disagree. (The composer's Send is disabled unless
  `connection === 'live'`, but the resume buttons are not.)
- **The history fold shares the live path's consecutive-identical-user-text de-dupe.** `commitUserText`
  drops a `user` text equal to the immediately preceding `user` entry with no assistant turn between (right
  for the live echo case), so two genuinely identical consecutive user turns in a stored transcript render
  as one. The equivalence test sidesteps it by slicing the leading prompt off — folding only the turns the
  live path also saw.
- **No browser verification.** The React layer — `useSessions`' fetch lifecycle, `useChat`'s socket, the
  History/transcript UI, the banner — is covered only by `typecheck` + `build` plus the reducer tests (which
  fold hand-built frames but never render). As with ticket 10, nothing the DOM produces is asserted by a test.

## Evidence

```
npm run typecheck → clean (shared build + server tsc --project + web tsc --project, no errors)
npm test          → shared: 7 passed (1 file) | server: 72 passed, 1 skipped (8 files) | web: 26 passed (2 files)
npm run build     → clean; vite 29 modules transformed, dist/assets/index-*.js 247.81 kB (gzip 75.63 kB)
```

The single skip is ticket 03's POSIX-only symlink-to-a-file case (`it.skipIf(win32)`). No test needs an API
key or the network: a grep of `*.test.ts(x)` for `ANTHROPIC_API_KEY`/`apiKey` and for `http(s)://`/`fetch(`
returns nothing, the only provider the suite drives is `server/src/testing/fake-provider.ts`, and the bus
tests bind loopback (`app.listen({ port: 0, host: '127.0.0.1' })` + `ws://127.0.0.1:<port>`).

By-hand WebSocket check on the integration tip `dc6cb3e` (re-run against the fake provider —
`server/src/testing/dev-fake.ts` booted with `PROJECTS_ROOT` at a temp dir holding one project `alpha`,
`PORT=3211`):

```
GET /api/projects                          → one project (alpha)
GET .../alpha/sessions                     → [{ id: 0000…0000, title: "A fake session", … }]
GET .../alpha/sessions/0000…0000/messages  → [{ role:user, content:[text "hello"] }, { role:assistant, … }]
ws://…/ws?projectId=… first frame          → snapshot { state:'idle', blocks:[], lastSeq:0 }, seq 1
send resume { sessionId } then send_prompt → stream_status turn_started
                                           → sdk init / stream_event delta / assistant / result
                                           → stream_status turn_ended    (no error frame)
```

So the REST list/transcript read complete blocks, and the socket rebuilds from `snapshot` first and, on
`resume` + send, runs the turn rather than rejecting it.

Manual checks (merger, on the integration tip):

- `git show --stat 53036f0` touches only `web/src/chat/*` (7 files; three created: `EntryView.tsx`,
  `SessionHistory.tsx`, `useSessions.ts`). `git diff dc6cb3e^ 53036f0 -- server/ shared/` is empty.
- `shared/src/protocol.ts` is the identical blob `659a99b3…` at the pre-11 tip `30b965d`, ticket 11's commit
  `53036f0`, the merge `dc6cb3e` and HEAD; `git diff --stat 30b965d dc6cb3e -- server/ shared/` is empty, so
  ticket 11 changed nothing under `server/` or `shared/`.
- One renderer: `EntryView` is imported by `ChatPanel.tsx` (the live transcript, line 127) and by
  `SessionHistory.tsx` (the read-only transcript, line 191); `fromSessionMessages` routes stored blocks
  through the same `applyAssistantBlock`/`applyUserBlock` the live fold uses.
- Resume sends no prompt: `useChat.resume` sets `resumeTarget` then sends the `resume` `ClientMessage`; the
  path never calls `sendPrompt`. The reducer tests pin arm (no entries/state change), clear on
  `turn_started`, and keep on a `turn_in_progress` rejection.
- The session list renders the provider's title as-is (`SessionHistory.tsx`: `{session.title}`).
