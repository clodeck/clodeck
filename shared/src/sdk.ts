/**
 * Structural mirrors of the Agent SDK types the client consumes.
 *
 * `@clodeck/shared` deliberately does **not** depend on
 * `@anthropic-ai/claude-agent-sdk`: the package bundles a native binary and
 * would be dragged into the web bundle. The SDK stays a server-only
 * dependency; the server narrows the real `SDKMessage` union to the families
 * mirrored here and assigns it to these types, and the `sdk` envelope payload
 * carries it unmodified (wayfinder 04 §2).
 *
 * **Assignability is the contract.** Each mirror below is deliberately *wider*
 * than the SDK's own type — optional where the SDK is optional, `string` where
 * the SDK lists literals the client never branches on, and open-ended where
 * the SDK's set can grow (content blocks, stream deltas) — so a real SDK
 * message always fits.
 *
 * Mirrored subset (wayfinder research 01 §2/§3): `system`, `assistant`, `user`,
 * `tool_progress`, `stream_event`, `result` — plus `conversation_reset`, the one
 * family the client acts on without rendering it. Message families outside it
 * are ignored by the client.
 */

import type { SlashCommand } from './commands.js';

/** The SDK's permission modes (research 01 §5). */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto';

/**
 * The modes clodeck offers, as the wire names them: the narrower contract the
 * product keeps, not the SDK's six-value union (ADR 0003). `auto` and `dontAsk`
 * are refused for good. `bypassPermissions` is a mode the wire carries, but it
 * is **gated at runtime**: `CLODECK_ALLOW_BYPASS` and a project's own
 * `disableBypassPermissionsMode` can each refuse it, and the snapshot says which
 * before a chip offers it (ticket 85).
 *
 * One list, because three consumers must agree: the wire validator, the boot
 * default, and the client's snapshot parser. A mode this list does not name is
 * one the server would refuse and no chip could render.
 */
export const SELECTABLE_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
] as const satisfies readonly PermissionMode[];

export type SelectablePermissionMode = (typeof SELECTABLE_PERMISSION_MODES)[number];

/** True when `value` is one of the modes clodeck offers today. */
export function isSelectablePermissionMode(value: unknown): value is SelectablePermissionMode {
  return SELECTABLE_PERMISSION_MODES.some((mode) => mode === value);
}

/**
 * Whether **Bypass** may be chosen in this project, and why not when it may not
 * (ticket 85). Two gates decide it, and both are the server's: the deployment's
 * `CLODECK_ALLOW_BYPASS`, and the project's own
 * `permissions.disableBypassPermissionsMode: "disable"`.
 *
 * A surface that cannot see the gates cannot explain them, so the snapshot
 * carries both the answer and its reason — a chip that simply went missing
 * would leave the user guessing whether Bypass exists at all. `reason` is
 * present exactly when `allowed` is false.
 */
export interface BypassAvailability {
  allowed: boolean;
  /** One sentence for the surface, when Bypass is refused. */
  reason?: string;
}

/** The authoritative turn state the SDK reports (research 01 §2). */
export type SessionState = 'idle' | 'running' | 'requires_action';

/* -------------------------------------------------------------------------- */
/* Content blocks                                                             */
/* -------------------------------------------------------------------------- */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  /**
   * Arbitrary JSON — the SDK types this as `unknown` too. Narrow it (a
   * `Record<string, unknown>` check) before reading a field such as `command`
   * or `file_path`.
   */
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  /** A string or a nested block array, depending on the tool. */
  content?: unknown;
  is_error?: boolean;
}

/**
 * Any block the client does not render. The API's block set is open-ended and
 * grows with the model (server tools, MCP tools, code execution, …), and
 * unknown blocks are ignored (research 01 §3) — so this member keeps exotic
 * blocks assignable. Note the cost: narrowing on a literal `type` yields this
 * member too, so pair it with a property guard (`'text' in block`).
 */
export interface UnknownContentBlock {
  type: string;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | UnknownContentBlock;

/* -------------------------------------------------------------------------- */
/* Anthropic API messages (what an SDK message carries)                       */
/* -------------------------------------------------------------------------- */

/** The API message inside an `assistant` SDK message. Each carries one block. */
export interface AssistantApiMessage {
  /** Blocks of one response share this id — use it to group them. */
  id: string;
  role: 'assistant';
  content: readonly ContentBlock[];
  model?: string;
  stop_reason?: string | null;
  usage?: unknown;
}

/**
 * The API message inside a `user` SDK message: tool results (the SDK feeds
 * them back) and echoed user input. `role` stays wide because the API types
 * `MessageParam.role` as `'user' | 'assistant' | 'system'` — a real SDK
 * `user` message can carry any of the three.
 */
export interface UserApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | readonly ContentBlock[];
}

/* -------------------------------------------------------------------------- */
/* stream_event                                                               */
/* -------------------------------------------------------------------------- */

/** A content block as it first appears in a stream — only the opening fields. */
export interface StreamContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
  thinking?: string;
}

/** One incremental delta. Raw deltas are not accumulated text — the client accumulates. */
export interface StreamDelta {
  type: string;
  text?: string;
  partial_json?: string;
  thinking?: string;
  signature?: string;
}

export type StreamEvent =
  | { type: 'message_start'; message: AssistantApiMessage }
  | { type: 'content_block_start'; index: number; content_block: StreamContentBlock }
  | { type: 'content_block_delta'; index: number; delta: StreamDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string | null }; usage?: unknown }
  | { type: 'message_stop' };

/* -------------------------------------------------------------------------- */
/* SDK messages                                                               */
/* -------------------------------------------------------------------------- */

/** Session init — the first place `session_id` and `cwd` appear (research 01 §4). */
export interface SDKSystemInitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
  tools: readonly string[];
  slash_commands?: readonly string[];
  /**
   * The subset of `slash_commands` whose UX is bound to the local terminal
   * (`exit`, `statusline`, …). The SDK's own words: "Phone/remote UIs should
   * hide these from command menus" — clodeck is exactly such a UI, so the menu
   * drops them (ticket 75).
   */
  terminal_slash_commands?: readonly string[];
  output_style?: string;
  skills?: readonly string[];
  mcp_servers?: readonly { name: string; status: string }[];
  uuid?: string;
}

/**
 * The full command list, pushed when it *changes* mid-session — a skill found
 * as the agent works, a skill installed on disk while a run is open.
 *
 * It is a replace, not a merge, in the SDK's own words: "clients should REPLACE
 * their cached command list with this payload". A run that has just started
 * sends no such push (checked against the SDK), which is why the current run's
 * list is also *asked for* — `supportedCommands()`, `server/src/sdk/provider.ts`.
 */
export interface SDKSystemCommandsChangedMessage {
  type: 'system';
  subtype: 'commands_changed';
  commands: readonly SlashCommand[];
  uuid?: string;
  session_id: string;
}

/** Long-running status ("compacting…", "requesting…"). */
export interface SDKSystemStatusMessage {
  type: 'system';
  subtype: 'status';
  status: 'compacting' | 'requesting' | null;
  session_id?: string;
  uuid?: string;
}

/** `idle` means the turn finished; `requires_action` means it waits on an approval. */
export interface SDKSystemSessionStateChangedMessage {
  type: 'system';
  subtype: 'session_state_changed';
  state: SessionState;
  session_id?: string;
}

/**
 * Every other `system` subtype (compact boundary, permission denied, thinking
 * tokens, task events, …). It widens `subtype` to `string`, so narrowing on a
 * `system` message means checking the known subtypes first and treating the
 * rest as this member.
 */
export interface SDKSystemOtherMessage {
  type: 'system';
  subtype: string;
  session_id?: string;
  uuid?: string;
}

/** One content block of a response. `parent_tool_use_id` non-null ⇒ a subagent frame. */
export interface SDKAssistantMessage {
  type: 'assistant';
  session_id: string;
  message: AssistantApiMessage;
  parent_tool_use_id: string | null;
  uuid?: string;
  error?: string;
  aborted?: true;
  timestamp?: string;
  /** Binds this reply to the user send it answers. */
  user_message_uuid?: string;
}

/** Tool results (synthetic) and echoed user input. */
export interface SDKUserMessage {
  type: 'user';
  message: UserApiMessage;
  parent_tool_use_id: string | null;
  session_id?: string;
  uuid?: string;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
}

/** Live "Using Bash… (3s)" indicators. */
export interface SDKToolProgressMessage {
  type: 'tool_progress';
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  session_id: string;
  uuid?: string;
  task_id?: string;
  heartbeat?: boolean;
  subagent_type?: string;
}

/** Only emitted when the session runs with partial messages enabled. */
export interface SDKStreamEventMessage {
  type: 'stream_event';
  session_id: string;
  event: StreamEvent;
  parent_tool_use_id: string | null;
  uuid?: string;
  ttft_ms?: number;
  user_message_uuid?: string;
}

/**
 * The SDK threw the conversation away and moved to a new one — `/clear`, leaving
 * plan mode with the clear-context option, a fresh-session flow, or onboarding.
 * The client mounts a fresh transcript under `new_conversation_id`, which is the
 * run's new **session**: the id `resume` continues from and the one the header
 * and History name.
 *
 * `trigger` says what discarded the conversation, and is informational — every
 * reset is a reset, whatever it says (and an older emitter may omit it).
 */
export interface SDKConversationResetMessage {
  type: 'conversation_reset';
  new_conversation_id: string;
  /** The session the frame was emitted on: the conversation being discarded. */
  session_id: string;
  trigger?: 'clear' | 'plan_mode_exit' | 'fresh_session' | 'onboarding';
  uuid?: string;
}

/**
 * One model's token totals from a `result` message, exactly as the SDK reports
 * them. Input is split the way the API bills it: `inputTokens` is the part
 * neither read from nor written to the cache, with cache traffic beside it.
 */
export interface SDKModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Turn complete. Read the latest result's usage — never sum them. */
export interface SDKResultSuccessMessage {
  type: 'result';
  subtype: 'success';
  /** The final assistant text. */
  result: string;
  session_id: string;
  is_error: boolean;
  num_turns: number;
  stop_reason: string | null;
  /**
   * Per-model token totals for the session so far — the SDK's own accounting,
   * and the field to read instead of `total_cost_usd`. Cumulative: a resumed
   * session's first result already carries its earlier turns, so read the latest
   * result rather than summing results (`.scratch/clodeck/research/01-token-cost.md`).
   */
  modelUsage: Readonly<Record<string, SDKModelUsage>>;
  /**
   * The SDK's client-side estimate, priced from Claude's list rates — not a
   * bill. A non-Claude model matches no price row, so the figure is a guess at
   * the default model's rate (9–82× the real DeepSeek bill here), and the UI
   * does not show it.
   */
  total_cost_usd: number;
  duration_ms: number;
}

export interface SDKResultErrorMessage {
  type: 'result';
  subtype:
    | 'error_during_execution'
    | 'error_max_turns'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries';
  session_id: string;
  is_error: boolean;
  errors: readonly string[];
  num_turns: number;
  stop_reason: string | null;
  /** The same per-model totals and the same cumulative rule as the success arm. */
  modelUsage: Readonly<Record<string, SDKModelUsage>>;
  /** The SDK's Claude-priced estimate — not a bill, and not shown. */
  total_cost_usd: number;
  duration_ms: number;
}

/**
 * The SDK message subset the client consumes. The server narrows the SDK's own
 * union to these families before assigning (research 01 §3: everything else is
 * ignored).
 */
export type SDKMessage =
  | SDKSystemInitMessage
  | SDKSystemStatusMessage
  | SDKSystemSessionStateChangedMessage
  | SDKSystemCommandsChangedMessage
  | SDKSystemOtherMessage
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKToolProgressMessage
  | SDKStreamEventMessage
  | SDKConversationResetMessage
  | SDKResultSuccessMessage
  | SDKResultErrorMessage;
