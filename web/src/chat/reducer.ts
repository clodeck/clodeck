import type {
  ApprovalRequestPayload,
  ContentBlock,
  ResumePayload,
  SDKMessage,
  ServerEvent,
  SessionMessage,
  SessionState,
  SnapshotPayload,
} from '@clodeck/shared';

/**
 * The event → view-model transformation, as a pure function.
 *
 * The whole chat surface is a fold: a `ServerEvent` arrives, a new `ChatView`
 * comes out. Keeping it free of React and of the socket is what makes the
 * streaming rules — delta accumulation, block reconciliation, subagent nesting —
 * testable without a DOM, which is where the real risk of this slice lives
 * (spec-02 §"Web client"; research 01 §3 is the mapping applied below).
 */

/* -------------------------------------------------------------------------- */
/* The view model                                                             */
/* -------------------------------------------------------------------------- */

export interface UserEntry {
  kind: 'user';
  text: string;
}

export interface AssistantEntry {
  kind: 'assistant';
  text: string;
}

export interface ThinkingEntry {
  kind: 'thinking';
  text: string;
}

/** A backend note that is not an SDK block (an interrupted turn). */
export interface NoticeEntry {
  kind: 'notice';
  text: string;
}

export interface ToolResultView {
  content: unknown;
  isError: boolean;
}

export interface ToolEntry {
  kind: 'tool';
  toolUseId: string;
  name: string;
  /** Arbitrary JSON, exactly as the block carried it. */
  input: unknown;
  /** The collapsed tool result, once the SDK feeds it back. */
  result: ToolResultView | null;
  /** Frames carrying this tool's id as `parent_tool_use_id` (a subagent) nest here. */
  children: readonly ChatEntry[];
}

export type ChatEntry = UserEntry | AssistantEntry | ThinkingEntry | NoticeEntry | ToolEntry;

export interface TurnResult {
  subtype: string;
  /** The final assistant text — present only on `subtype: 'success'`. */
  text: string | null;
  costUsd: number;
  stopReason: string | null;
  numTurns: number;
  isError: boolean;
  errors: readonly string[];
  /**
   * Whether the result is one a user can continue from. research 01 §3 offers
   * "resume" on exactly two stop conditions — a turn that ran out of turns or
   * budget — so the UI does not have to know those subtype strings itself.
   */
  canResume: boolean;
}

export interface ChatView {
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  /** The authoritative turn state the SDK reports. */
  state: SessionState;
  entries: readonly ChatEntry[];
  /** Text accumulated from `stream_event` deltas, not yet reconciled by a block. */
  streamingText: string;
  /** A tool announced by `content_block_start` before its complete block arrives. */
  streamingTool: { name: string; partialJson: string } | null;
  /** The latest `tool_progress`, as a live "Using …" indicator. */
  progress: { toolName: string; elapsedSeconds: number } | null;
  /** A transient long-running status ("compacting"). */
  status: string | null;
  /** The latest `result`; its cost is cumulative, so it is read, never summed. */
  lastResult: TurnResult | null;
  pendingApprovals: readonly ApprovalRequestPayload[];
  lastError: { code: string; message: string } | null;
  /**
   * The target the next `send_prompt` will resume from. The bus holds the same
   * value in memory and consumes it on the next send; the client mirrors it
   * solely so the user can see what a send is about to continue (ticket 11).
   */
  resumeTarget: ResumePayload | null;
}

export function emptyView(): ChatView {
  return {
    sessionId: null,
    cwd: null,
    model: null,
    state: 'idle',
    entries: [],
    streamingText: '',
    streamingTool: null,
    progress: null,
    status: null,
    lastResult: null,
    pendingApprovals: [],
    lastError: null,
    resumeTarget: null,
  };
}

/* -------------------------------------------------------------------------- */
/* The fold                                                                   */
/* -------------------------------------------------------------------------- */

export function applyServerEvent(view: ChatView, event: ServerEvent): ChatView {
  switch (event.kind) {
    case 'sdk':
      return applySdkMessage(view, event.payload);
    case 'snapshot':
      return fromSnapshot(event.payload);
    case 'approval_request':
      return withApproval(view, event.payload);
    case 'stream_status':
      return withStreamStatus(view, event.payload.status);
    case 'error':
      return { ...view, lastError: { code: event.payload.code, message: event.payload.message } };
    default:
      // The envelope is a closed union, but the wire is untrusted: a kind this
      // client does not know is ignored rather than left to fall through.
      return view;
  }
}

/**
 * `snapshot` is the whole state, not a delta: it arrives first on every
 * (re)connect, so folding its complete blocks over an empty view is what makes
 * a reload or a dropped socket recover, and what keeps a pending approval modal
 * alive across the reconnect (spec-02 §"Approvals").
 */
function fromSnapshot(payload: SnapshotPayload): ChatView {
  let view: ChatView = {
    ...emptyView(),
    state: payload.state,
    pendingApprovals: [...payload.pendingApprovals],
  };
  for (const block of payload.blocks) {
    view = applySdkMessage(view, block);
  }
  return view;
}

function withStreamStatus(view: ChatView, status: 'turn_started' | 'turn_ended' | 'interrupted'): ChatView {
  switch (status) {
    case 'turn_started':
      // The bus consumes the resume target as it starts the turn, so the banner
      // goes with it — what was a pending target is now the turn in flight.
      return { ...view, state: 'running', lastError: null, resumeTarget: null };
    case 'turn_ended':
      return flush({ ...view, state: 'idle' });
    case 'interrupted':
      return appendEntry(flush({ ...view, state: 'idle' }), { kind: 'notice', text: 'Interrupted' }, null);
    default:
      return view;
  }
}

function withApproval(view: ChatView, request: ApprovalRequestPayload): ChatView {
  if (view.pendingApprovals.some((pending) => pending.requestId === request.requestId)) return view;
  return { ...view, pendingApprovals: [...view.pendingApprovals, request] };
}

/* -------------------------------------------------------------------------- */
/* SDK messages                                                               */
/* -------------------------------------------------------------------------- */

export function applySdkMessage(view: ChatView, message: SDKMessage): ChatView {
  switch (message.type) {
    case 'system':
      return applySystem(view, message);
    case 'stream_event':
      return applyStreamEvent(view, message);
    case 'assistant':
      return applyAssistant(view, message);
    case 'user':
      return applyUser(view, message);
    case 'tool_progress':
      return {
        ...view,
        progress: { toolName: message.tool_name, elapsedSeconds: message.elapsed_time_seconds },
      };
    case 'result':
      return applyResult(view, message);
    default:
      // A family outside the mirror is ignored, never rendered and never fatal
      // (research 01 §3).
      return view;
  }
}

type SystemMessage = Extract<SDKMessage, { type: 'system' }>;

function applySystem(view: ChatView, message: SystemMessage): ChatView {
  switch (message.subtype) {
    case 'init':
      return {
        ...view,
        sessionId: str(prop(message, 'session_id')) ?? view.sessionId,
        cwd: str(prop(message, 'cwd')) ?? view.cwd,
        model: str(prop(message, 'model')) ?? view.model,
      };
    case 'status':
      return { ...view, status: str(prop(message, 'status')) };
    case 'session_state_changed': {
      const state = asSessionState(prop(message, 'state'));
      return state === null ? view : withSessionState(view, state);
    }
    default:
      // Every other system subtype (compact boundary, tasks, …) is ignored.
      return view;
  }
}

function applyStreamEvent(view: ChatView, message: Extract<SDKMessage, { type: 'stream_event' }>): ChatView {
  const event = message.event;
  switch (event.type) {
    case 'content_block_start':
      // A tool opening announces itself before its full block arrives — the
      // "[Using X…]" indicator.
      return event.content_block.type === 'tool_use'
        ? { ...view, streamingTool: { name: str(event.content_block.name) ?? '', partialJson: '' } }
        : view;
    case 'content_block_delta': {
      if (event.delta.type === 'text_delta') {
        const text = str(event.delta.text);
        return text === null ? view : { ...view, streamingText: view.streamingText + text };
      }
      if (event.delta.type === 'input_json_delta') {
        const partial = str(event.delta.partial_json);
        if (partial === null || view.streamingTool === null) return view;
        return {
          ...view,
          streamingTool: { ...view.streamingTool, partialJson: view.streamingTool.partialJson + partial },
        };
      }
      return view;
    }
    default:
      // message_start/stop, block stop, message_delta carry nothing to render.
      return view;
  }
}

function applyAssistant(view: ChatView, message: Extract<SDKMessage, { type: 'assistant' }>): ChatView {
  let next = view;
  for (const block of message.message.content) {
    next = applyAssistantBlock(next, block, message.parent_tool_use_id);
  }
  return next;
}

function applyAssistantBlock(view: ChatView, block: ContentBlock, parentToolUseId: string | null): ChatView {
  switch (block.type) {
    case 'text': {
      const text = str(prop(block, 'text'));
      if (text === null || text === '') return view;
      // Reconcile: the complete block is authoritative, so the accumulated
      // deltas are cleared as it lands — the text is rendered exactly once.
      return appendEntry({ ...view, streamingText: '' }, { kind: 'assistant', text }, parentToolUseId);
    }
    case 'thinking': {
      const text = str(prop(block, 'thinking'));
      return text === null || text === '' ? view : appendEntry(view, { kind: 'thinking', text }, parentToolUseId);
    }
    case 'tool_use': {
      const toolUseId = str(prop(block, 'id'));
      const name = str(prop(block, 'name'));
      if (toolUseId === null || name === null) return view;
      const entry: ToolEntry = {
        kind: 'tool',
        toolUseId,
        name,
        input: prop(block, 'input'),
        result: null,
        children: [],
      };
      // The live indicator is replaced by the card it announced.
      return appendEntry({ ...view, streamingTool: null }, entry, parentToolUseId);
    }
    default:
      // redacted_thinking and every unknown block type are ignored.
      return view;
  }
}

function applyUser(view: ChatView, message: Extract<SDKMessage, { type: 'user' }>): ChatView {
  const content = message.message.content;
  const parentToolUseId = message.parent_tool_use_id;
  if (typeof content === 'string') return commitUserText(view, content, parentToolUseId);

  let next = view;
  for (const block of content) {
    next = applyUserBlock(next, block, parentToolUseId);
  }
  return next;
}

/** A `user`-side block: a tool result to collapse, or echoed prompt text. */
function applyUserBlock(view: ChatView, block: ContentBlock, parentToolUseId: string | null): ChatView {
  if (block.type === 'tool_result') return attachResult(view, block);
  if (block.type === 'text') {
    const text = str(prop(block, 'text'));
    if (text !== null) return commitUserText(view, text, parentToolUseId);
  }
  return view;
}

function applyResult(view: ChatView, message: Extract<SDKMessage, { type: 'result' }>): ChatView {
  // The fields every result carries, whichever arm builds it: cost is cumulative
  // (read the latest, never summed), and both variants can be continued when the
  // SDK capped the turn rather than failed it (research 01 §3).
  const common = {
    costUsd: message.total_cost_usd,
    stopReason: message.stop_reason,
    numTurns: message.num_turns,
    isError: message.is_error,
    canResume: RESUMABLE_SUBTYPES.has(message.subtype),
  };
  const lastResult: TurnResult =
    message.subtype === 'success'
      ? { subtype: 'success', text: message.result, errors: [], ...common }
      : { subtype: message.subtype, text: null, errors: message.errors, ...common };
  return { ...view, lastResult };
}

/**
 * The two stop conditions a user is expected to continue from — a turn that
 * exhausted its turn or budget cap. Any other error subtype is a failure to fix,
 * not a turn to resume.
 */
const RESUMABLE_SUBTYPES = new Set<string>(['error_max_turns', 'error_max_budget_usd']);

/* -------------------------------------------------------------------------- */
/* Local actions (the composer and the modal, not the server)                 */
/* -------------------------------------------------------------------------- */

/**
 * The user's own prompt, shown immediately rather than waiting for the round
 * trip. The bus echoes the prompt only on some paths, so a later identical
 * `user` block is folded away by {@link commitUserText} instead of doubled.
 */
export function withUserPrompt(view: ChatView, text: string): ChatView {
  return text === '' ? view : { ...view, entries: [...view.entries, { kind: 'user', text }] };
}

/** The modal closes as the answer is sent; the server parks no further frame. */
export function dismissApproval(view: ChatView, requestId: string): ChatView {
  return { ...view, pendingApprovals: view.pendingApprovals.filter((pending) => pending.requestId !== requestId) };
}

export function clearError(view: ChatView): ChatView {
  return view.lastError === null ? view : { ...view, lastError: null };
}

/**
 * Mirrors a `resume` control message into the view. The message itself sends no
 * prompt — it only arms the next `send_prompt` — so this is the whole client
 * side of "resume": show what will be continued, and wait for `turn_started`
 * (the bus's own signal that it consumed the target) to clear it.
 */
export function withResumeTarget(view: ChatView, target: ResumePayload): ChatView {
  return { ...view, resumeTarget: target };
}

/* -------------------------------------------------------------------------- */
/* History (a past transcript, through the same block rules)                  */
/* -------------------------------------------------------------------------- */

/**
 * Folds a stored transcript into the view model the live renderer already
 * consumes. History and live share one renderer by construction: a transcript
 * replays the same `ContentBlock`s a live message carries, so this reuses the
 * exact per-block rules above rather than a parallel path (spec-02 §"Session
 * history & resume (REST)"; `shared/src/session.ts`).
 */
export function fromSessionMessages(messages: readonly SessionMessage[]): ChatView {
  let view = emptyView();
  for (const message of messages) {
    view = applySessionMessage(view, message);
  }
  return view;
}

/** One stored turn — an `assistant` message or a `user` one (prompt or tool result). */
export function applySessionMessage(view: ChatView, message: SessionMessage): ChatView {
  const parentToolUseId = message.parentToolUseId ?? null;
  let next = view;
  for (const block of message.content) {
    next =
      message.role === 'assistant'
        ? applyAssistantBlock(next, block, parentToolUseId)
        : applyUserBlock(next, block, parentToolUseId);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/** Renders a `user` text block, unless it restates the entry just added. */
function commitUserText(view: ChatView, text: string, parentToolUseId: string | null): ChatView {
  if (text === '') return view;
  if (parentToolUseId === null) {
    const last = view.entries[view.entries.length - 1];
    if (last !== undefined && last.kind === 'user' && last.text === text) return view;
  }
  return appendEntry(view, { kind: 'user', text }, parentToolUseId);
}

/** Attaches a tool result to the card that owns it, collapsed underneath it. */
function attachResult(view: ChatView, block: ContentBlock): ChatView {
  const toolUseId = str(prop(block, 'tool_use_id'));
  if (toolUseId === null) return view;
  const result: ToolResultView = { content: prop(block, 'content'), isError: prop(block, 'is_error') === true };
  const entries = attachToolResult(view.entries, toolUseId, result);
  return entries === null ? view : { ...view, entries };
}

/** Clears the transient streaming fields — a finished turn leaves nothing live. */
function flush(view: ChatView): ChatView {
  return { ...view, streamingText: '', streamingTool: null, progress: null, status: null };
}

function withSessionState(view: ChatView, state: SessionState): ChatView {
  const next = { ...view, state };
  return state === 'idle' ? flush(next) : next;
}

/**
 * Places an entry: at the top level, or — for a frame with a
 * `parent_tool_use_id` — inside the tool card it belongs to. A frame whose
 * parent card is missing still lands at the top level rather than vanishing.
 */
function appendEntry(view: ChatView, entry: ChatEntry, parentToolUseId: string | null): ChatView {
  if (parentToolUseId === null) return { ...view, entries: [...view.entries, entry] };
  const nested = nestIn(view.entries, parentToolUseId, (children) => [...children, entry]);
  return { ...view, entries: nested ?? [...view.entries, entry] };
}

/** Replaces the result of the tool card with `toolUseId`, at any depth. */
function attachToolResult(
  entries: readonly ChatEntry[],
  toolUseId: string,
  result: ToolResultView,
): readonly ChatEntry[] | null {
  return rewriteTool(entries, toolUseId, (entry) => ({ ...entry, result }));
}

function nestIn(
  entries: readonly ChatEntry[],
  toolUseId: string,
  toChildren: (children: readonly ChatEntry[]) => readonly ChatEntry[],
): readonly ChatEntry[] | null {
  return rewriteTool(entries, toolUseId, (entry) => ({ ...entry, children: toChildren(entry.children) }));
}

/** Applies `update` to the tool card with `toolUseId`; `null` when none matches. */
function rewriteTool(
  entries: readonly ChatEntry[],
  toolUseId: string,
  update: (entry: ToolEntry) => ToolEntry,
): readonly ChatEntry[] | null {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || entry.kind !== 'tool') continue;
    if (entry.toolUseId === toolUseId) {
      const copy = [...entries];
      copy[index] = update(entry);
      return copy;
    }
    const nested = rewriteTool(entry.children, toolUseId, update);
    if (nested !== null) {
      const copy = [...entries];
      copy[index] = { ...entry, children: nested };
      return copy;
    }
  }
  return null;
}

function asSessionState(value: unknown): SessionState | null {
  return value === 'idle' || value === 'running' || value === 'requires_action' ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Reads a field by name. The mirror types some families wider than the client
 * branches on (`system` subtypes share one open `subtype: string` member), so a
 * field is read and checked rather than accessed through a narrowing the type
 * cannot guarantee.
 */
function prop(source: object, key: string): unknown {
  return (source as Record<string, unknown>)[key];
}
