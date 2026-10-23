import type { SlashCommand } from './commands.js';
import type { BypassAvailability, PermissionMode, SDKMessage, SessionState } from './sdk.js';

/**
 * The wire protocol between the server and the browser: one JSON envelope
 * shape in each direction (wayfinder 04 §2). Both are discriminated unions, so
 * a new kind/type is a compile error at every switch that must handle it.
 */

/** Stamped on every envelope; lets the client reject a protocol it does not know. */
export const PROTOCOL_VERSION = 1;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

/* -------------------------------------------------------------------------- */
/* Server → client                                                            */
/* -------------------------------------------------------------------------- */

/** Fields every event carries; the run it belongs to is routed by the three ids. */
interface ServerEventBase {
  v: ProtocolVersion;
  /** Per-connection monotonic counter (reset on reconnect): ordering and gap detection. */
  seq: number;
  /** ISO 8601 timestamp. */
  ts: string;
  projectId?: string;
  sessionId?: string;
  turnId?: string;
}

/**
 * `canUseTool` is a callback, not an SDK message, so approvals need an
 * envelope kind of their own. Fields map 1:1 to the callback (research 01 §5).
 */
export interface ApprovalRequestPayload {
  requestId: string;
  toolUseID: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Primary prompt text ("Claude wants to read foo.txt"). */
  title?: string;
  /** Short noun phrase for the buttons ("Read file"). */
  displayName?: string;
  description?: string;
  /**
   * Why this gate opened, when the SDK's own reason or clodeck's Bash hook
   * supplies one. The modal shows it beside the command; a plain tool gate
   * carries none.
   */
  decisionReason?: string;
  /** Ready-made "always allow" rules; echoed back unread by `approval_response`. */
  suggestions?: readonly unknown[];
  defaultToNo?: boolean;
  /**
   * Whether this request may be answered with "Always allow Bash for this
   * session" (ticket 96). Present — and true — only when clodeck's own Bash
   * gate opened the prompt, which the server proves from the request's
   * `decisionReason`: a prompt a project's `permissions.ask` rule forced
   * carries no such offer, because a session allow never loosens a project
   * rule. Absent means the third answer is not the user's to give here.
   */
  canAllowBashForSession?: boolean;
}

/** Sent on (re)connect: the run's state plus the session's complete blocks. */
export interface SnapshotPayload {
  state: SessionState;
  /**
   * The mode the run's next turn will start in. Always present: it is the
   * session's choice when one was made, and the boot default otherwise — the
   * one fact a reconnecting client needs to show the effective mode again.
   */
  permissionMode: PermissionMode;
  /**
   * Whether Bypass may be chosen here, and why not when it may not (ticket 85).
   * Always present, and read from the two gates that can refuse it: this
   * server's `CLODECK_ALLOW_BYPASS` and the project's own settings. It rides the
   * snapshot because it is a property of the run's project, not of the
   * connection — a client that reconnects learns the current answer again.
   */
  bypass: BypassAvailability;
  /**
   * Whether this run answers its own Bash gate without asking — the modal's
   * "Always allow Bash" (ticket 96). Always present, like the mode: it is
   * session state the run keeps, so a reconnecting client shows the badge again
   * without having granted it in this connection. `false` for every run that
   * has not granted it.
   */
  bashAllowedForSession: boolean;
  /** Complete messages only — buffered deltas are collapsed, never replayed. */
  blocks: readonly SDKMessage[];
  pendingApprovals: readonly ApprovalRequestPayload[];
  /**
   * The command list this run reported, when it reported one. It is here
   * because it is not a *block*: `supportedCommands()` answers outside the
   * message stream, so without this a reconnect would drop the run's list and
   * the menu would fall back to the project's files alone. Absent while no run
   * has listed anything — which is the state every connection opens in.
   */
  commands?: readonly SlashCommand[];
  lastSeq: number;
}

/**
 * The run's own command list, pushed once as it starts.
 *
 * Not an SDK message: the SDK pushes its list only when it *changes*
 * (`commands_changed`), and a session that has just started has sent no such
 * push — checked against the SDK rather than assumed. So the run is *asked*,
 * and the answer travels in an envelope kind of its own rather than dressed up
 * as a message the run never sent.
 */
export interface CommandsPayload {
  commands: readonly SlashCommand[];
}

export type StreamStatus = 'turn_started' | 'turn_ended' | 'interrupted';

/** Turn boundaries are backend events, so they cannot come from an SDK message. */
export interface StreamStatusPayload {
  status: StreamStatus;
}

/**
 * The run's session allow changed (ticket 96). Its own frame rather than a
 * snapshot: the grant is one fact, and replaying the transcript to state it
 * would disturb a live stream. Every socket on the project receives it, so two
 * tabs agree on whether Bash still asks.
 */
export interface SessionAllowPayload {
  bash: boolean;
}

export interface ServerErrorPayload {
  code: string;
  message: string;
  turnId?: string;
}

export type ServerEvent = ServerEventBase &
  (
    | { kind: 'sdk'; payload: SDKMessage }
    | { kind: 'approval_request'; payload: ApprovalRequestPayload }
    | { kind: 'snapshot'; payload: SnapshotPayload }
    | { kind: 'commands'; payload: CommandsPayload }
    | { kind: 'stream_status'; payload: StreamStatusPayload }
    | { kind: 'session_allow'; payload: SessionAllowPayload }
    | { kind: 'error'; payload: ServerErrorPayload }
  );

/* -------------------------------------------------------------------------- */
/* Client → server                                                            */
/* -------------------------------------------------------------------------- */

/** Fields every control message carries. */
interface ClientMessageBase {
  v: ProtocolVersion;
  id: string;
}

export interface SendPromptPayload {
  prompt: string;
  /**
   * The profile this turn runs on. Absent means the reserved **default** —
   * the server's own environment — so a client that never chooses one asks for
   * exactly what it asked for before profiles existed.
   *
   * The name is untrusted like every other field on the wire: the server
   * resolves it against its boot-time list and refuses an unknown one visibly,
   * rather than falling back to the default.
   */
  profile?: string;
  /**
   * The permission mode this turn runs under. Absent means the run's stored
   * mode — which is the boot default until a session chooses — so a send
   * carries the choice of the *next* message without a second frame, and a
   * reconnect that lost the client's local state still runs on what the
   * server kept.
   *
   * The value is untrusted: the validator refuses a mode the contract does not
   * offer rather than forwarding it to the SDK (ADR 0003).
   */
  permissionMode?: PermissionMode;
}

/** No fields: interrupt targets the project's one active turn. */
export type InterruptPayload = Record<string, never>;

/**
 * No fields: the project is named by the socket. It drops the project's run
 * state — the armed resume target *and* the buffered transcript — so the next
 * send starts a session of its own instead of continuing the old one. Without
 * it, an armed target could only be dropped by a send that consumed it, and a
 * reconnect would hand the previous session's transcript back (ticket 11's
 * first gap).
 */
export type ClearResumePayload = Record<string, never>;

export interface ApprovalResponsePayload {
  /** The `requestId` of the `approval_request` being answered. */
  requestId: string;
  behavior: 'allow' | 'deny';
  /** Allow-with-edits: the input the tool should run with instead. */
  updatedInput?: Record<string, unknown>;
  /** "Always allow": the request's `suggestions`, echoed back. */
  updatedPermissions?: readonly unknown[];
  /** Deny reason, shown to the model. */
  message?: string;
  /**
   * The modal's third answer (ticket 96): allow this call *and* stop asking for
   * Bash for the rest of the session. Only honoured when the parked request
   * carried `canAllowBashForSession` — the server checks the request it is
   * answering, not this flag, so a client cannot grant itself more than the
   * gate offered.
   */
  allowBashForSession?: boolean;
}

export interface SetPermissionModePayload {
  mode: PermissionMode;
}

/**
 * No fields: the project is the socket's, and the clear is the whole message.
 * It takes back the session's "Always allow Bash" (ticket 96) — the badge beside
 * the composer — so the next Bash call parks again. The grant itself needs no
 * frame of its own: it rides the `approval_response` that made it.
 */
export type ClearBashSessionAllowPayload = Record<string, never>;

/** `continue` needs no id (most recent session in the cwd); `fork` branches the history. */
export type ResumePayload = { mode: 'continue' } | { sessionId: string; fork?: boolean };

export type ClientMessage = ClientMessageBase &
  (
    | { type: 'send_prompt'; payload: SendPromptPayload }
    | { type: 'interrupt'; payload: InterruptPayload }
    | { type: 'clear_resume'; payload: ClearResumePayload }
    | { type: 'approval_response'; payload: ApprovalResponsePayload }
    | { type: 'set_permission_mode'; payload: SetPermissionModePayload }
    | { type: 'clear_bash_session_allow'; payload: ClearBashSessionAllowPayload }
    | { type: 'resume'; payload: ResumePayload }
  );
