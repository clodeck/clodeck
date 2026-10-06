# 01 — Agent SDK: session, streaming, resume (research)

> Question: what does the TypeScript Agent SDK expose for (a) creating a session bound to a cwd, (b) streaming message/tool/result events to a client, and (c) resuming/forking a session later — and what concrete event shape should a chat UI consume?

## TL;DR for the chat UI

- One function does everything: **`query({ prompt, options })`** from **`@anthropic-ai/claude-agent-sdk`**. It returns a `Query`, which is an `AsyncGenerator<SDKMessage>` — you `for await` it and forward each message to the browser.
- Bind a session to a directory with **`options.cwd`** (defaults to `process.cwd()`); widen file access with `options.additionalDirectories`.
- A single `query()` call runs the *whole* agent loop (Claude takes as many turns as it needs) and streams the full lifecycle as typed messages.
- To render a Claude Code-like experience, enable **`options.includePartialMessages: true`** and consume **`type: 'stream_event'`** messages for live text/tool tokens, plus **`type: 'assistant'` / `type: 'user'`** for complete content blocks, **`type: 'tool_progress'`** for "Using X..." indicators, and **`type: 'result'`** for the turn-complete signal (final text, cost, `session_id`, `subtype`).
- Persist the **`session_id`** (available on the `init` system message and again on every result). Later, pass **`options.resume = sessionId`** to continue, **`options.forkSession: true`** (with `resume`) to branch, or **`options.continue: true`** to pick up the most recent session in that directory.
- Approval UI hooks in via **`options.canUseTool`** (a callback you provide that receives the tool name + input and returns `{ behavior: 'allow' | 'deny', ... }`). Claude's clarifying questions arrive as `toolName === 'AskUserQuestion'`.
- Session transcripts live on disk at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`; use **`options.sessionStore`** to mirror them to your own backend for cross-host/resume.

---

## 1. Package & entry points

- Package: **`@anthropic-ai/claude-agent-sdk`** (researched at **v0.3.292**; the exact type shapes below are quoted from the published `sdk.d.ts`).
- Root import: `import { query } from "@anthropic-ai/claude-agent-sdk";`
- Bundle-friendly subpath (v0.3.282+): `import { query } from "@anthropic-ai/claude-agent-sdk/core";`
- Other subpaths exist for specialized surfaces: `./browser` (browser SDK), `./bridge` (Remote Control bridge), `./sdk-tools`, `./extract`.

The SDK bundles a native Claude Code binary, so no separate CLI install is required. API-key auth only (Anthropic does not permit third parties to offer claude.ai login/rate limits through the SDK).

### `query()` signature

```typescript
function query({ prompt, options }: {
  prompt: string | AsyncIterable<SDKUserMessage>;  // string = one-shot; AsyncIterable = streaming input
  options?: Options;
}): Query;   // Query extends AsyncGenerator<SDKMessage, void>
```

The `Query` object also exposes control methods a UI backend will use: `interrupt()`, `setPermissionMode(mode)`, `setModel(model)`, `streamInput(stream)`, `getContextUsage()`, `readFile(path)`, `mcpServerStatus()`, `supportedModels()`, `close()`, etc.

### `Options` — the fields that matter for a web UI (full list is ~100 entries)

| Option | Type / default | Purpose |
| :- | :- | :- |
| **`cwd`** | `string` = `process.cwd()` | **Working directory the session is bound to.** This is the per-project directory. |
| `additionalDirectories` | `string[]` = `[]` | Extra dirs Claude may access (`--add-dir`) |
| **`sessionId`** | `string` = auto-generated UUID | Set a specific session UUID |
| **`resume`** | `string` = undefined | **Session ID to resume** |
| **`forkSession`** | `boolean` = false | With `resume`, fork to a new session ID |
| **`continue`** | `boolean` = false | Continue the most recent session in the directory (no ID needed) |
| **`persistSession`** | `boolean` = true | `false` keeps the session in memory only (no disk write) |
| `sessionStore` / `sessionStoreFlush` | `SessionStore` / `'batched'|'eager'` | Mirror transcripts to your own backend (cross-host resume) |
| `settingSources` | `SettingSource[]` = `['user','project','local']` | Which settings files load; `[]` disables all |
| `systemPrompt` | string / array / preset object | Custom or preset system prompt |
| `permissionMode` | `PermissionMode` | Session permission mode (see §5) |
| `allowedTools` / `disallowedTools` | `string[]` = `[]` | Auto-approve / block tools |
| `canUseTool` | `CanUseTool` | **Your approval callback** (see §5) |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | Lifecycle hooks (PreToolUse, PostToolUse, Stop, …) |
| `mcpServers` | `Record<string, McpServerConfig>` | MCP servers |
| **`includePartialMessages`** | `boolean` = false | **Emit `stream_event` deltas** (enable for live streaming) |
| `includeHookEvents` | `boolean` = false | Include hook lifecycle events in the stream |
| `maxTurns` / `maxBudgetUsd` | number = undefined | Loop safety limits |
| `model` / `fallbackModel` | string | Model choice |
| `env` | `Record<string, string|undefined>` = `process.env` | Replaces subprocess env (merge `{ ...process.env, ... }`) |
| `abortController` | `AbortController` | Cancel the run |
| `permissionPrompts` / `permissionPromptToolName` | `'host'|'none'` / string | Where permission prompts are answered / MCP prompt tool |
| `stderr` | `(data: string) => void` | Stderr callback |
| `title` | string | Display title |

`PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`.
`SettingSource = 'user' | 'project' | 'local'` (precedence highest→lowest: local → project → user → programmatic options → managed policy).

---

## 2. The streamed message types (`SDKMessage`)

`query()` yields a discriminated union; each message has a string `type` field. The **five core types** a UI must handle, then the supporting types:

### Core: `system` (init)

```typescript
type SDKSystemMessage = {
  type: 'system';
  subtype: 'init';
  cwd: string;                        // ← the session's working directory
  session_id: string;                 // ← capture this for resume/fork
  model: string;
  permissionMode: PermissionMode;
  tools: string[];                    // built-in tools available
  mcp_servers: { name: string; status: string; source?: string }[];
  slash_commands: string[];
  output_style: string;
  skills: string[];
  claude_code_version: string;
  apiKeySource: ApiKeySource;
  plugins: { name: string; path: string; version?: string }[];
  capabilities?: string[];            // feature-detect instead of version-sniffing
  uuid: UUID;
};
```

Other `system` subtypes are their own union members in TS: `SDKStatusMessage` (`subtype: 'status'`, `status: 'compacting'|'requesting'|null`), `SDKCompactBoundaryMessage` (`subtype: 'compact_boundary'`), `SDKSessionStateChangedMessage` (`subtype: 'session_state_changed'`, `state: 'idle'|'running'|'requires_action'` — the authoritative turn-over signal), `SDKPermissionDeniedMessage`, `SDKThinkingTokensMessage`, task messages, etc.

### Core: `assistant` (one content block each)

```typescript
type SDKAssistantMessage = {
  type: 'assistant';
  uuid: UUID;
  session_id: string;
  message: BetaMessage;               // Anthropic SDK message — content blocks live at message.message.content
  parent_tool_use_id: string | null;  // non-null => this frame belongs to a subagent
  error?: SDKAssistantMessageError;
  aborted?: true;
  timestamp?: string;
  context_usage?: SDKContextUsage;
  user_message_uuid?: string;         // binds this reply to the user send it answers
  resume_reason?: string;
};
```

Each `AssistantMessage` carries **one** content block; blocks from one response share `message.message.id`. Content block types come from the Anthropic Messages API: `text`, `tool_use` (`.name`, `.input`, `.id`), `thinking`, plus `redacted_thinking`.

### Core: `user` (tool results and user inputs)

```typescript
type SDKUserMessage = {
  type: 'user';
  uuid?: UUID;
  session_id?: string;
  message: MessageParam;              // content blocks include `tool_result`
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;              // true for tool-result messages fed back to Claude
  shouldQuery?: boolean;
  tool_use_result?: unknown;
  ...
};
```

### Core: `result` (turn complete)

```typescript
type SDKResultMessage = SDKResultSuccess | SDKResultError;

type SDKResultSuccess = {
  type: 'result';
  subtype: 'success';
  result: string;                     // final assistant text
  session_id: string;
  is_error: boolean;
  num_turns: number;
  stop_reason: string | null;         // 'end_turn' | 'max_tokens' | 'refusal' | ...
  total_cost_usd: number;             // cumulative estimated cost (read the latest result, don't sum)
  usage: NonNullableUsage;            // main agent loop only
  modelUsage: Record<string, ModelUsage>; // whole-tree token/cost accounting — prefer this
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
  duration_ms: number;
  duration_api_ms: number;
  queued_turn_count?: number;         // >0 => another turn (and result) follows without input
  uuid: UUID;
  ...
};

type SDKResultError = {
  type: 'result';
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  is_error: boolean;
  errors: string[];
  session_id: string;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: Record<string, ModelUsage>;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
  permission_denials: SDKPermissionDenial[];
  startup_failure_reason?: SDKStartupFailureReason;
  uuid: UUID;
  ...
};
```

**`result` is the turn-complete signal.** `subtype: 'success'` is the only variant where `result` (final text) is present. All variants carry `total_cost_usd`, `usage`, `modelUsage`, `num_turns`, `session_id` — so you can track cost and resume even after errors. Important gotcha: in single-shot (`prompt: string`) mode the SDK **yields the error result and then throws**; wrap the loop in try/catch. Don't `break` on the result — a few trailing system messages (e.g. `prompt_suggestion`) can follow it.

### Streaming: `stream_event` (only when `includePartialMessages: true`)

```typescript
type SDKPartialAssistantMessage = {
  type: 'stream_event';
  event: BetaRawMessageStreamEvent;   // raw Anthropic Messages API streaming event
  parent_tool_use_id: string | null;  // always null (stream events are main-session only)
  uuid: UUID;
  session_id: string;
  ttft_ms?: number;
  user_message_uuid?: string;
};
```

The `event` field is the raw API stream event. The event types a UI consumes:

| `event.type` | Meaning / payload |
| :- | :- |
| `message_start` | New assistant message begins |
| `content_block_start` | New content block begins — `event.content_block.type` is `text` or `tool_use`; for `tool_use`, `event.content_block.name` is the tool |
| `content_block_delta` | Incremental token — `event.delta.type` is `text_delta` (`event.delta.text`) or `input_json_delta` (`event.delta.partial_json` for tool args) |
| `content_block_stop` | Content block complete |
| `message_delta` | Stop reason / usage |
| `message_stop` | Message complete |

These are **raw deltas, not accumulated text** — the UI accumulates them itself. A complete `assistant` message for that block still follows (arrives before the block's `content_block_stop`), so a UI can either render deltas live and reconcile on the complete message, or skip partials entirely.

### Supporting: tool progress (for "Using X…" indicators)

```typescript
type SDKToolProgressMessage = {
  type: 'tool_progress';
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  task_id?: string;
  heartbeat?: boolean;
  subagent_type?: string;
  uuid: UUID;
  session_id: string;
};
```

Also useful: `SDKToolUseSummaryMessage` (`type: 'tool_use_summary'`, `summary`, `preceding_tool_use_ids`), `SDKThinkingTokensMessage` (`subtype: 'thinking_tokens'`, `estimated_tokens`, `estimated_tokens_delta` — redacted-thinking progress), `SDKTaskStartedMessage` / `SDKTaskProgressMessage` / `SDKTaskUpdatedMessage` (task/todo tracking).

---

## 3. Concrete renderer mapping for a chat UI

Backend runs `query()` in Node and forwards each `SDKMessage` (JSON-serialized) to the browser over SSE/WebSocket. Frontend switches on `message.type`:

| `type` | Render |
| :- | :- |
| `system` / `subtype:'init'` | Store `session_id`, `cwd`, `model`, `permissionMode`; initialize project context |
| `system` / `subtype:'status'` | "compacting…", "requesting…" status pill |
| `system` / `subtype:'session_state_changed'` | `idle` = turn finished (flush UI); `requires_action` = waiting on approval |
| `stream_event` | Append `text_delta` to the current bubble; show "[Using {name}...]" on `tool_use` start; accumulate `input_json_delta` |
| `assistant` | Reconcile the completed block: `text` → bubble text; `tool_use` → tool card (name + input); `thinking` → collapsible thinking |
| `user` | Tool results (collapse under the tool card); distinguish `parent_tool_use_id` to nest subagent frames |
| `tool_progress` | Live "Using Bash… (3s)" indicator |
| `result` | Turn done: render `result` (success), cost, `stop_reason`; on `error_max_turns`/`error_max_budget_usd` offer "resume" |
| anything else | Ignore (task notifications, rate limits, etc. — not required to drive the loop) |

Nesting rule: `parent_tool_use_id` non-null means a frame originates inside a subagent — indent it or attach to the parent tool card. For attribution of *which user message* a reply answers, use `user_message_uuid` (present on `assistant`, `stream_event`, and `result`).

---

## 4. Sessions: persistence, resume, fork

### Where session state lives

- Local transcripts: **`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`** (encoded-cwd = absolute path with every non-alphanumeric char replaced by `-`; `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_PROJECT_DIR_NAME` override the base/name).
- Sessions persist the **conversation, not the filesystem** — file checkpointing is a separate feature.

### Session ID

- Read from the **`init` `system` message** (`message.session_id`) — earliest place in TS — or from **any `result` message** (`message.session_id`, present on success *and* error).
- Set it explicitly with `options.sessionId`, or let the SDK auto-generate a UUID.

### Resume / continue / fork (all are `Options` fields)

- **`continue: true`** — resume the most recent session in `cwd`, no ID tracking (good for one conversation per directory).
- **`resume: sessionId`** — resume a specific session (required for multi-user / multiple sessions).
- **`resume: sessionId` + `forkSession: true`** — create a **new** session that starts with a copy of the original's history; the original stays unchanged. The fork gets its own `session_id` (read it from the new run's init/result). Forking branches conversation history, **not** filesystem state.

Resume is same-machine by default (the session file must exist locally). For cross-host / serverless resume, pass **`options.sessionStore`** (an adapter with `append(key, entries)`, `load(key)`, `listSessions?`, `delete?`, `listSubkeys?` — the CLI still writes locally first, then mirrors). Resumed sessions continue cost/usage totals from their saved transcript.

### Session management helpers (also exported)

```typescript
listSessions(options?: { dir?, limit?, includeWorktrees? }): Promise<SDKSessionInfo[]>
getSessionMessages(sessionId, options?: { dir?, limit?, offset? }): Promise<SessionMessage[]>
getSessionInfo(sessionId, options?: { dir? }): Promise<SDKSessionInfo | undefined>
renameSession(sessionId, title, options?): Promise<void>
tagSession(sessionId, tag | null, options?): Promise<void>
resolveSettings(options?): Promise<ResolvedSettings>
```

`SDKSessionInfo` = `{ sessionId, summary, lastModified, fileSize?, customTitle?, firstPrompt?, gitBranch?, cwd?, tag?, createdAt? }` — use `listSessions()` for a session-history picker (title, cwd, last modified) and `getSessionMessages()` to rebuild a transcript view.

---

## 5. Permissions, hooks & approval surfaces a UI must present

### `canUseTool` callback (the main approval surface)

```typescript
type CanUseTool = (toolName: string, input: Record<string, unknown>, options: {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];   // ready-made "always allow" rules to echo back
  blockedPath?: string;
  decisionReason?: string;
  title?: string;                     // primary prompt text ("Claude wants to read foo.txt")
  displayName?: string;               // short noun phrase ("Read file") for buttons
  description?: string;               // subtitle
  defaultToNo?: boolean;
  suppressAlwaysAllowRule?: boolean;
  toolUseID: string;
  agentID?: string;
  requestId: string;
}) => Promise<PermissionResult | null>;
```

Return value:

```typescript
type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[]; decisionClassification?: ... }
  | { behavior: 'deny'; message: string; interrupt?: boolean; ... };
```

A chat UI's approval modal: show `title`/`displayName`/`description`, render `input` (e.g. Bash `command`, Edit `old_string`/`new_string`, Write `file_path`/`content`), offer **Allow once** (`{ behavior:'allow', updatedInput: input }`), **Always allow** (echo `suggestions` back in `updatedPermissions`), **Deny** (`{ behavior:'deny', message }`), and optionally **Allow with edits** (modified `updatedInput`).

### Clarifying questions (`AskUserQuestion`)

When `toolName === 'AskUserQuestion'`, `input` is `{ questions: [{ question, header, options: [{ label, description, preview? }], multiSelect }] }` (1–4 questions, 2–4 options each). Render them, then return:

```typescript
{ behavior: 'allow', updatedInput: { questions: input.questions, answers: { "<question text>": "<selected label>" } } }
```

If you pass a `tools` array, keep `"AskUserQuestion"` in it or Claude can't ask.

### Permission modes (set per session or change live with `query.setPermissionMode()`)

`default` (callback decides anything not pre-approved) · `acceptEdits` (auto-approve edits + common fs commands) · `plan` (no edits, asks through callback) · `dontAsk` (deny instead of prompt; callback never called) · `auto` (model classifier reviews) · `bypassPermissions` (auto-approve all, needs `allowDangerouslySkipPermissions: true`). For an interactive single-user UI, `default` + `canUseTool` is the natural fit.

### Denial notification

`SDKPermissionDeniedMessage` (`subtype: 'permission_denied'`, with `tool_name`, `tool_use_id`, `message`, `decision_reason`) tells the UI when a call was auto-denied so it can show "denied" without a prompt round-trip.

### Hooks

`options.hooks` maps hook events (e.g. `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStart/Stop`, `PreCompact`, `PermissionRequest`) to callbacks that run in your process (not in the model's context) and can allow/deny/modify tool calls. `PermissionRequest` hook can decide approvals instead of `canUseTool` (useful for external/async approval systems). `includeHookEvents: true` surfaces hook lifecycle events in the stream.

---

## 6. Concrete minimum for a Claude Code-like MVP

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: userMessage,
  options: {
    cwd: projectDir,                       // one session per project directory
    includePartialMessages: true,          // live text/tool streaming
    settingSources: ["project"],           // load the project's CLAUDE.md/skills/hooks
    allowedTools: ["Read", "Glob", "Grep"],// read-only by default; Edit/Write/Bash gated by canUseTool
    permissionMode: "default",
    canUseTool: approvalHandler,           // your modal -> allow/deny
  },
});

for await (const msg of q) {
  // switch on msg.type per §3; capture msg.session_id on init & result;
  // forward JSON to the browser via SSE/WebSocket
}
// later: query({ prompt, options: { cwd, resume: savedSessionId, ... } })
// or:   query({ prompt, options: { cwd, resume: savedSessionId, forkSession: true, ... } })
```

---

## Sources

- Agent SDK overview — https://code.claude.com/docs/en/agent-sdk
- TypeScript reference (`query`, `Options`, `SDKMessage`, `SDKResultMessage`, `SDKPartialAssistantMessage`, `CanUseTool`, session helpers) — https://code.claude.com/docs/en/agent-sdk/typescript
- Work with sessions (continue/resume/fork, transcript location, `sessionStore`) — https://code.claude.com/docs/en/agent-sdk/sessions
- How the agent loop works (message lifecycle, result subtypes) — https://code.claude.com/docs/en/agent-sdk/agent-loop
- Stream responses in real-time (`includePartialMessages`, `StreamEvent` payload) — https://code.claude.com/docs/en/agent-sdk/streaming-output
- Configure permissions (evaluation order, modes) — https://code.claude.com/docs/en/agent-sdk/permissions
- Handle approvals and user input (`canUseTool`, `AskUserQuestion`) — https://code.claude.com/docs/en/agent-sdk/user-input
- Session storage (cross-host resume adapter) — https://code.claude.com/docs/en/agent-sdk/session-storage
- Published type declarations (exact field-level types, v0.3.292) — `sdk.d.ts` from `@anthropic-ai/claude-agent-sdk` (via unpkg/jsdelivr; repo: github.com/anthropics/claude-agent-sdk-typescript)
