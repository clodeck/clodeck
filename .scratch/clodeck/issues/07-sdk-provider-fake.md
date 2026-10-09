# 07: SDK provider facade, session types, and fake

**What to build:** The SDK sits behind one provider interface — `query`, `listSessions`, `getSessionMessages` — so the rest of the server depends on shared types, and automated tests drive a scripted fake with no API key or network. The session-history types (`SessionSummary`, `SessionMessage`) are declared in shared, and a real provider implementation normalizes SDK history to them.

**Blocked by:** 06

**Status:** resolved

- [x] A `SdkProvider` interface exposes `query` (an async stream of mirrored SDK messages plus `interrupt()`/`setPermissionMode()`), `listSessions`, and `getSessionMessages`, all in terms of shared types.
- [x] `SessionSummary` (`{ id, title, createdAt?, lastModified?, tag? }`) and `SessionMessage` (`{ role, content: ContentBlock[], toolUseId?, parentToolUseId? }`) are declared in shared and re-exported from the shared entry point.
- [x] The real provider imports the SDK only inside the server, streams mirrored messages through the narrowing function, and normalizes SDK session info to `SessionSummary` (title fallback `customTitle → summary → firstPrompt → "Untitled"`) and SDK messages to `SessionMessage`.
- [x] `query()` runs with `includePartialMessages: true`, `permissionMode: 'default'`, `allowedTools: ['Read','Glob','Grep']` (read-only auto-approve; everything else via `canUseTool`), `settingSources: ['project']`, and default `env`; the server never handles the API key (the SDK reads it from the environment).
- [x] A scripted fake provider (in test support, not shipped) streams a pre-written queue of mirrored SDK messages and returns canned `listSessions`/`getSessionMessages`.
- [x] Every automated test runs against the fake provider — none requires a key or network.

## What landed

```
shared/src/session.ts             SessionSummary + SessionMessage                 — the history contracts
shared/src/index.ts               re-exports ./session.js                          — already-public entry point
server/src/sdk/provider.ts        SdkProvider / SdkRun / SdkRunInput / ApprovalCallback — no SDK import
server/src/sdk/anthropic.ts       createAnthropicProvider() — the only runtime SDK importer
server/src/testing/fake-provider.ts    createFakeProvider() — scripted fake + control surface
server/src/testing/dev-fake.ts         npm run dev:fake boot entry (hand-driving, no key)
server/src/app.ts                 buildApp({ projects, provider }) — the provider is now a seam
server/src/main.ts                boots with createAnthropicProvider()
server/tsconfig.build.json        excludes src/testing from dist (test support, not shipped)
```

- **The facade.** `SdkProvider` is three methods in shared types: `query(input)` returns an `SdkRun`
  (`messages: AsyncIterable<SDKMessage>` of the mirror, plus `interrupt()` / `setPermissionMode()`),
  and `listSessions` / `getSessionMessages` return `SessionSummary[]` / `SessionMessage[]`. `provider.ts`
  imports no SDK — only shared types — so `tsc` keeps the SDK out of every module that merely *uses* a
  session. `ApprovalCallback` is the envelope's own `ApprovalRequestPayload → ApprovalResponsePayload`
  (wayfinder 04 §2), so one approval shape serves the bus, the provider and the wire.
- **The real provider's `query()` options are exactly** `includePartialMessages: true`,
  `allowedTools: ['Read', 'Glob', 'Grep']`, `settingSources: ['project']`, `permissionMode:
  input.permissionMode ?? 'default'`, plus `cwd` and an `abortController`; `resume`/`forkSession`/
  `continueLatest`/`canUseTool` are added only when set. **There is no `env` key** — setting `Options.env`
  would *replace* the process environment rather than merge, so the SDK reads the API key from it
  untouched; nothing in the repo reads `ANTHROPIC_API_KEY` (grep-verified).
- **The fake's control surface.** `createFakeProvider(options)` streams a scripted queue of mirrored
  messages per `query()` and returns canned history; on top of `SdkProvider` it records every `query()`
  input / `setPermissionMode` / `interrupt` in an append-only call log with `waitForQueryInput(n)` /
  `waitForPermissionMode(n)` / `waitForInterrupt(n)` (resolving immediately when the call already
  happened), and `requestApproval(request)` drives the run's own `canUseTool` from outside — the SDK's
  side of an approval — so ticket 08 can answer an approval through the bus and watch the promise settle.
- **Normalizer rules.** `normalizeSessionInfo`: `id = sessionId`, title `customTitle || summary ||
  firstPrompt || 'Untitled'` (each empty value counts as absent), `lastModified`/`createdAt` converted
  epoch-ms → ISO 8601 (non-finite dropped), `tag` copied; `fileSize`/`cwd`/`gitBranch` dropped. It re-sorts
  nothing — the SDK already returns `lastModified` descending. `normalizeSessionMessage`: `role = type`
  (a `TranscriptTurn`, so no `system` arm), `content` from the persisted JSON — a plain string prompt
  wraps as one text block, non-block members are dropped — and the entry's **`toolUseId` is hoisted** from
  its content (a `tool_use` block's `id`, or the `tool_use_id` a `tool_result` answers), with
  `parentToolUseId` set from `parent_tool_use_id` when non-null, so a transcript's tool card and its
  result find each other through one block renderer.
- **Two deviations the implementer flagged, both sound.** (1) `normalizeSessionMessage` takes a
  `TranscriptTurn = Omit<SdkSessionMessage,'type'> & {type:'user'|'assistant'}`, and `getSessionMessages`
  filters with `isTranscriptTurn` (`type !== 'system'`) before mapping — the SDK's own `SessionMessage.type`
  really is `'user'|'assistant'|'system'` (verified in `sdk.d.ts:6539`), so the shared `role` needs no
  runtime cast and system rows (compact boundaries, notices) can never be mislabelled a turn;
  `includeSystemMessages: false` is also stated explicitly. (2) The third pure export `toSdkCanUseTool`
  bridges `ApprovalCallback → SDK CanUseTool`, mapping the callback's `requestId`/`toolUseID`/`title`/
  `displayName`/`description`/`suggestions`/`defaultToNo` into the shared request and the response back to
  `PermissionResult` (allow with optional `updatedInput`/`updatedPermissions`, deny with a required
  `message`); it is exported precisely because it is the one shape the fake cannot stand in for.
  (3) The `toolUseId` hoisting rule is documented on the field itself in `shared/src/session.ts`.
- **Known and deliberate:** the hoist names the **first** tool_use/tool_result id in an entry, so an
  assistant message that issues parallel tool calls carries only the first at top level — every block
  stays in `content`, and each `tool_result` still names its own call, so nothing is lost; and the
  provider is threaded into `buildApp` but not yet read by a route — the `/ws` bus (ticket 08) and the
  history routes (ticket 09) are its first consumers.

## Evidence

```
npm test          → shared: 7 passed; server: 39 passed | 1 skipped (40); web: 2 passed
npm run typecheck → clean (shared + server + web)
npm run build     → clean (shared tsc, server tsc, web tsc + vite)
```

The one skipped test is ticket 03's pre-existing POSIX-only file-symlink case, unrelated to this ticket.

Manual checks on the closed commit (`790b745`, empty `git diff 15766ee HEAD -- shared/src/protocol.ts`
— byte-identical):

```
imports of @anthropic-ai/* at runtime   → only server/dist/sdk/anthropic.js; mirror.js/d.ts are type-only
server/dist/testing/                    → absent (tsconfig.build.json excludes src/testing)
reads of ANTHROPIC_API_KEY across repo  → none
server/src/sdk/provider.ts imports      → shared types only; no @anthropic-ai import (one prose mention)
query() options (anthropic.ts)          → includePartialMessages:true, allowedTools:['Read','Glob','Grep'],
                                          settingSources:['project'], permissionMode:'default' default, no env
```

`normalizeSessionInfo` / `normalizeSessionMessage` / `toSdkCanUseTool` are covered by
`server/src/sdk/anthropic.test.ts`; the fake's control surface by `server/src/testing/fake-provider.test.ts`;
the shared shapes and their entry-point re-export by `shared/src/index.test.ts`. The `query()` options
object and the `isTranscriptTurn` guard have no direct test (the former needs the SDK to observe, the
latter is a one-line predicate), so they are verified by reading the source.
