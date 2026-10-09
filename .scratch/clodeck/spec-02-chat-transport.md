# Clodeck — chat/transport slice (WS event bus + Agent SDK streaming + session resume)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Slice-e 01 yek monorepo-e strict-TypeScript va ye path-e amal shode (`PROJECTS_ROOT` → allowlist → `GET /api/projects` → switcher) ro dast dad, amma hanooz hich chat-i nist. Envelope-ha (`ServerEvent` / `ClientMessage` dar `shared/src/protocol.ts`) va mirror-e `SDKMessage` (`shared/src/sdk.ts`) az slice-e 01 `declared-but-unused` hastan va gharar ast hamin slice vasl-eshun kone. Riski-tarin bakhsh-e baqi-monde hamoon *wiring*-e: `query()`-e Agent SDK ro be ye bus-e WebSocket beresoonim, be gune-i ke token-ha live stream beshan, tool/approval jaryan beshe, va session-ha ba'd az reload resume beshan. Ta in path kar nakone, Clodeck faghat ye switcher ast, na ye agent.

## Solution

SDK ro faghat be `server` add mikonim va mirror ro bar-ash pin mikonim (assignability check-e `const payload: SDKMessage = sdkMessage` avvalin bar compile mishe). SDK ro posht-e ye interface (`SdkProvider`) mizarim ta test-ha fake be charkhanand, na SDK-e vaghe'i. Ye bus-e WebSocket-e JSON dar `/ws` (az hamin `buildApp`) event-ha ro frame mikonad, control message-ha (`send_prompt` / `interrupt` / `approval_response` / `set_permission_mode` / `resume`) ro migirad, va `query()` ro be vasile-ye `canUseTool` be modal-e approval-e client vasl mikonad. History/resume ham az hamin provider miad (`listSessions` / `getSessionMessages`) va be ye REST-e normal-shode expose mishe. Client React-e slice-e 01 hamoon seam ro edame mide (`useProjects` → `useChat` / `useSessions`) va stub-e Chat ro ba ye renderer-e streaming-e vaghe'i avaz mikonad.

## User Stories

1. As a developer, I want `@anthropic-ai/claude-agent-sdk` add shode be `server` faghat (hargez `shared`/`web`), so that the native-binary SDK never reaches the web bundle.
2. As a developer, I want the real `SDKMessage` assignability to the shared mirror to *compile* (the pin), so that a mirror narrower than the SDK breaks the build where it must be handled.
3. As a developer, I want the mirror widened only where the SDK is wider (no `any`, no SDK types in `shared`, no envelope change), so that the pin compiles without weakening the contract.
4. As a developer, I want the SDK behind one provider interface (`query` + `listSessions` + `getSessionMessages`), so that automated tests use a scripted fake and never need an API key or network.
5. As the user, I want tokens to appear incrementally as the agent replies, so that the response feels live.
6. As the user, I want tool cards and "Using …" indicators, so that I can see what the agent is doing.
7. As the user, I want a permission modal (allow / deny) when the agent wants a gated tool, so that I stay in control.
8. As the user, I want sending a prompt while a turn is running to be rejected, so that the model is never double-driven.
9. As the user, I want an interrupt action, so that I can stop a runaway turn.
10. As the user, I want a session list per project, so that I can find a past conversation.
11. As the user, I want to open a past session and read its transcript, so that history is legible.
12. As the user, I want to resume a specific session (by id), so that a conversation continues where it left off.
13. As the user, I want a "continue latest" affordance, so that I do not need to remember an id.
14. As the user, I want a browser reload not to lose my session, so that refreshing is safe.
15. As the user, I want a dropped socket to recover to the current state, so that a network blip does not strand a running turn.
16. As a frontend developer, I want control messages typed from the shared envelope, so that a contract change breaks the client at compile time.
17. As a security-conscious operator, I want the `/ws` project id re-validated against the allowlist, so that an unauthenticated client cannot drive the SDK against an arbitrary directory.
18. As a developer, I want the bus tested against a fake provider, so that stream ordering, resume and approvals are covered without the SDK.

## Implementation Decisions

### SDK dependency & the mirror pin

- `@anthropic-ai/claude-agent-sdk` be `server` add mishe (dependency, exact version pin; research 01 be v0.3.292 st'naad karde — implementer taghir-e akhar ra nasb va pin mikonad). `shared` va `web` hargez oon ra nadarand (wayfinder 01 / spec-01 §Shared types).
- **The pin** dar ye module-e `server` ke faghat hamin module SDK ra import mikonad: ye `narrowToMirror(message: RealSDKMessage): SDKMessage | null` ke ba `switch` bar `message.type` famil-haye mirror shode ra entekhab mikonad (`system` / `assistant` / `user` / `tool_progress` / `stream_event` / `result`) va baghie ra ignore mikonad (`default` → `null`; research 01 §3). Har `case` real-famil ra be mirror-famil assign mikonad — hamin assignment-ha *pin* hastand: agar SDK change bokonad va real-message dar mirror ja nashe, `tsc` daghighan inja fail mishe. In hamoon `const payload: SDKMessage = sdkMessage`-e handoff ast, be shekl-e narrowing, chon real union az mirror por-membar-tar ast (famil-haye `tool_use_summary` / task-* / baghie).
- **In avvalin bar ast ke mirror compile mishe**, pas miror-e mojood momken ast be nazar be-resad ke dar ye field az SDK kamtar ast (candidate-haye shenakhte-shode: `assistant.error` ke dar SDK structured ast na `string`, `uuid`/`UUID`, shape-e `message`/content-block-ha). Vaghti pin fail beshe, ta'mir in ast: field-e mirror ra *pahn-tar* kon (`unknown` ya structural) — na `any`, na SDK-type dar `shared`, na taghir-e shape-e envelope. Widen-kardan-e field, na tarh-e dobare (spec-01 §Shared types va handoff).
- Envelope **vasl mishe, na dobare tarh**: `protocol.ts` be hamoon shekl mimoonad. `sdk.payload` hamoon mirror-e `SDKMessage` ast; "passthrough unmodified" (wayfinder 04 §2) be vasile-ye assignment-e type-level (na field-by-field re-modeling) tahghigh peida mikonad — JSON-e forwarded hamoon object ast.

### SDK provider facade (seam-e dovom)

- Ye interface dar `server` — `SdkProvider` — ke tamam-e chiz-i ke baqie-ye server az SDK mikhahad ra be zabaan-e shared-type expose mikonad:
  - `query(input): SdkRun` — ye `SdkRun` ba `messages: AsyncIterable<SDKMessage>` (mirror) va control (`interrupt()`, `setPermissionMode(mode)`). `input`: `{ cwd, prompt, resume?, fork?, continueLatest?, permissionMode?, canUseTool?, signal? }`.
  - `listSessions(dir): Promise<SessionSummary[]>` — history (wayfinder 06 §4).
  - `getSessionMessages(sessionId, dir): Promise<SessionMessage[]>` — transcript (wayfinder 06 §5).
- `dir` hamishe canonical project path ast (az id decode + allowlist be dast miad); provider hargez path-e raw nemigirod.
- `canUseTool` bar asas-e shared type-ha-ye `ApprovalRequestPayload` / `ApprovalResponsePayload` type mishe (hamoon payload-ha-ye envelope) — yek shape, se ja (bus callback = provider callback = envelope payload; wayfinder 04 §2, research 01 §5).
- **Real impl** (`server/src/sdk/anthropic.ts`-like) faghat module-i ast ke `@anthropic-ai/claude-agent-sdk` import mikonad: `narrowToMirror` ro dar stream, va normal-sazi-ye `SDKSessionInfo → SessionSummary` (title fallback `customTitle → summary → firstPrompt → "Untitled"`) va `SDKSessionMessage → SessionMessage` ro dar history. `query()` ba `includePartialMessages: true`, `permissionMode: 'default'`, `allowedTools: ['Read','Glob','Grep']` (read-only auto-approve; baghie az `canUseTool`), `settingSources: ['project']`, `env` default (research 01 §6) — in konkret-minimum hast, ye policy ke operator bad-tar taghir midehad. Key (`ANTHROPIC_API_KEY`) ra server hargez nagirad: SDK az environment mikhanad.
- **Fake/scripted provider** dar test-support (na shipped code): ye `query()`-e jaali ke ye queue-e az-pish-neveshte-ye `SDKMessage` stream mikonad (tamiz mikone ke test ordering/resume/approval ra bedoone network drive kone), plus `listSessions`/`getSessionMessages`-e canned. Test-ha faqat ba fake kar mikonand — hich test-e automati key/network nemikhahad (ghaede-ye 3).

### The `/ws` event bus (seam-e asli: hamoon `buildApp`)

- `/ws` dar hamin `buildApp` register mishe (ba `@fastify/websocket` bar rooye Fastify instance; impl detail), na ye server-e joda — `main.ts` va test-ha az hamin root miyaband-esh.
- **Connection project-scoped ast**: `/ws?projectId=<id>` (ya bind-e avvalin). Dalil: envelope-e `ClientMessage` hich `projectId`-i nadarad (faghat `v`/`id`; `protocol.ts`), pas socket bayad be ye project band shavad ta `send_prompt`/`interrupt` bedanand bar rooye kodoom project action konand. `ServerEvent`-ha hanooz `projectId` tag mishavand (baraye contract va routing). In *wiring*-e envelope ast, na dobare tarh; wayfinder 04 §3 "one multiplexed bus per browser session" ra be model-e clodeck (ye project-e montakhab dar ye zaman) mibandad — multi-project multiplex konning bedoone taghir-e envelope ba'd-tar miad.
- **Security:** bar upgrade, projectId decode → `canonicalizeInsideRoot` (hamoon allowlist-seam; wayfinder 05 §5) → agar reject → socket close + `error`. Chon `/ws` unauthenticated ast va SDK ra bar rooye `cwd` drive mikonad, in validation fargh-e beyn-e ye demo va ye primitive-e RCE ast. `HOST` loopback mimoonad (wayfinder 07 out of scope).
- Har event az `ServerEvent`-e `protocol.ts` build mishe; `seq` per-connection monotonic (reset on reconnect), `ts` ISO, `sessionId` az `session_id`-e message vaghti hast, `turnId` az turn-e jari. Kinds: `sdk` (har SDKMessage), `approval_request`, `snapshot`, `stream_status`, `error` — hame dar `protocol.ts` ta'rif shode-and.
- **Per-project run state in-memory** (wayfinder 06 §6 — hich DB nist): `idle | running | requires_action`, active `SdkRun`, buffered blocks, pending approvals, resume target, va `turnId`-e jari. Survive-e socket-reconnect (haman server process) mikonad, amma na restart — history az disk-e SDK miad (zir).

### Turn lifecycle & control messages

- `send_prompt` → agar project `running` ast → `error { code: 'turn_in_progress' }` (wayfinder 04 §4). Vagarna: `turnId` mint, `stream_status: turn_started`, `query()` ba `cwd`/`prompt`/resume-target-e jari, har SDKMessage be `sdk` envelope (ba `seq`), `result` → `stream_status: turn_ended`. `session_id` az init/result capture va be state-e project neveshte mishe (zamin-e "continue latest").
- `interrupt` → `query.interrupt()` → `stream_status: interrupted`. `set_permission_mode` → `run.setPermissionMode`.
- `resume` target-e project ra set mikonad (`{ mode:'continue' }` → `continue: true` dar query-e ba'di; `{ sessionId, fork? }` → `resume`/`forkSession`; wayfinder 06 §3). Khod-e `resume` prompt nemiferestad — send-e ba'di ba target-e resume ejra mishe. "New session" = client state clear; hich chiz bar rooye disk ta avvalin send neveshte nemishe (wayfinder 06 §7).
- Yek turn-e fa'el dar har project; chand project mitavand parallel be run-e (wayfinder 04 §4), ama model-e clodeck dar in slice ye project-e montakhab dar ye zaman darad.

### Approvals

- `canUseTool` bridge ast beyn-e SDK (dakhel-e real provider) va client. Bus callback ra be `query` midahad; vaghti SDK tool-i ra miporsad, bus `approval_request` emite mikonad, ye promise-e pending be `requestId` register mikonad, va bar `approval_response`-e client resolve mikonad → callback natije ra bar migardanad. `AskUserQuestion` ham az hamin path miad (`toolName === 'AskUserQuestion'`; research 01 §5).
- `snapshot.pendingApprovals` approval-haye outstanding ra bar reconnect dobare miferestad (pas ye modal-e pending az reconnect zende mimoonad). Client-e MVP faqat Allow / Deny miferestad (`{ behavior }`); allow-with-edits va "always allow" (echo-e `suggestions`) dar payload hast vali UI-esh optional-e in slice.

### Session history & resume (REST)

- `GET /api/projects/:id/sessions` → `{ sessions: SessionSummary[] }` (`{ id, title, createdAt?, lastModified?, tag? }`; title fallback dakhel-e provider; ordered `lastModified` desc — order-e SDK; wayfinder 06 §4).
- `GET /api/projects/:id/sessions/:sid/messages` → `{ messages: SessionMessage[] }` (`{ role:'user'|'assistant', content: ContentBlock[], toolUseId?, parentToolUseId? }`; complete blocks only, hich `stream_event`; no pagination; wayfinder 06 §5).
- `:id` → canonicalize (allowlist) → `dir`; `SessionMessage.content` az mirror-e `ContentBlock` (sdk.ts) dobare estefade mikonad, pas live va history **yek** block-renderer darand (wayfinder 06 §5).
- `SessionSummary` / `SessionMessage` dar `shared` declare mishe (module-e jadid `session.ts`, re-export az `index.ts`) — be mānande-ye ticket 02 ke envelope ra zood-tar declare kard; in "wiring" ast, na re-model, chon wayfinder 06 shape ra qat'i karde.

### Web client

- Chat panel stub ra avaz mikonad (dar `App.tsx`, haman layout). Do seam-e data, be shekl-e `useProjects`:
  - `useChat(project)` — native `WebSocket` be `/ws?projectId=…`; connect/reconnect (backoff), `snapshot` ro bar connect rebuild mikonad, `sdk` event-ha ra accumulate mikonad, control message-ha ra az shared `ClientMessage` type mishavand. State union: `connecting | live | error`, va turn state.
  - `useSessions(project)` — `GET …/sessions` / `…/messages` baraye list va load-e transcript.
- Renderer mapping az research 01 §3: `stream_event` delta accumulate → bubble-e matn; `assistant` complete-block reconcile; `tool_use` → tool card; `tool_result` → collapse; `thinking` → collapsible; `tool_progress` → "Using Bash…"; `result` → done + cost; baghie ignore. `parent_tool_use_id` baraye nesting-e subagent.
- Approval modal (title/displayName/description + input + Allow/Deny), composer + interrupt. Continue-latest / resume affordance ba'd az list-e sessions.
- Control message-ha (`send_prompt` etc.) az shared `ClientMessage` type mishavand, pas contract-change dar compile mipokad (haman shekl-e ticket 04).

## Testing Decisions

- **What makes a good test:** assert external behavior — envelope-shape va ordering, na private function. Har jaa ke momken ast, provider-e fake; hargez SDK-e vaghe'i, hargez key/network.
- **The two agreed seams (instruction):**
  1. **`buildApp({ projects, provider })`** — haman Fastify instance, hala ba `/ws` va `/api/projects/:id/...`. REST (history) ba `inject()`. WS ba `app.listen({ port: 0 })` + ye WS-client-e test (loopback `127.0.0.1`, ephemeral port — in "network" nist dar ma'nā-ye external API/Anthropic; local socket ast) ke envelope-e vaghe'i ra end-to-end test mikonad.
  2. **Fake `SdkProvider`** — ye `query()`-e scripted ke queue-e SDKMessages ra stream mikonad; test-ha ordering, turn lifecycle, resume (continue / by-id / fork), rejection-e "turn in progress", approval round-trip, va snapshot/reconnect ra bedoone SDK push mikonand.
- **No third seam.** Bus-core (turn-manager) agar be module-e joda facture beshe, ba hamoon fake provider unit-test mishe — amma seam-e mojodi hazf/ezafe nemishe.
- **Coverage that matters:** (a) fake `query` message-ordering → envelope `seq`/kind/sessionId/turnId; (b) `send_prompt`-e dovvom dar `running` → `error turn_in_progress`; (c) `interrupt` → `stream_status interrupted`; (d) approval: `approval_request` emits, `approval_response` resolve mikonad; (e) snapshot bar reconnect ba blocks + pendingApprovals; (f) resume-target → query-e ba'di `resume`/`continue` migirad; (g) history normalization shape-e exact (list title-fallback, transcript complete-blocks); (h) `/ws` projectId-e ghayr-e allowlist → close/reject.
- **The pin is compile-time, not a test:** `narrowToMirror` bar `tsc` tekie mikonad; test-e shared-e mojood (`index.test.ts`) hanooz ke `shared` SDK-nadari ra pin mikonad.
- **Non-goal:** no live-SDK test, no browser e2e (chat az dev-server + fake-provider mode be dast drive mishe, haman shekl-e ticket 04; SDK-e vaghe'i manual).

## Out of Scope

- Terminal/PTY (wayfinder 02), auth/login (07), Docker/Caddy (08).
- File drawer REST ops va file viewer-e kamel (03); live file editing; git explorer; model picker (UI).
- Multi-project multiplex konning bar rooye ye socket (eventual, bedoone taghir-e envelope); "remember last session per project" (client `localStorage`, agar khast).
- `sessionStore` mirror / cross-host resume (seam-e future-e wayfinder 06 §6).
- Any server-side session DB; any auth on `/ws` beyond allowlist.

## Further Notes

- In slice faghat wiring ast: SDK provider, bus, history, va chat-client — na dobare-tarhi-e chiz-i ke wayfinder ya slice-01 tasmim gerefte. Har jaa be tasmim-e wayfinder este'ad mide, ba shomare-ye ticket va § eshare kon (mesl-e "wayfinder 04 §2").
- Ticket-ha az **`06`** edame mikonand (01–05 ghablan estefade shode). Ye split-e tabi'i (baraye `/to-tickets`): (06) SDK dep + pin + widen-e mirror; (07) `SdkProvider` interface + fake; (08) bus/`/ws` + control messages + approvals; (09) history REST + `SessionSummary`/`SessionMessage`; (10) client chat + renderer + approval modal; (11) client history/resume + reconnect/snapshot.
- `main.ts` hanooz `HOST` loopback default mikonad; hich key-handling dar server nist (SDK az env mikhanad).
- `buildApp` signature be `{ projects, provider }` tabdil mishe; test-ha-ye mojood-e `app.test.ts` be provider-e fake update mishavand (mechanical).
