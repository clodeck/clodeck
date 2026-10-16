import type { PermissionMode, SDKMessage, SessionState } from './sdk.js';

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
  /** Ready-made "always allow" rules; echoed back unread by `approval_response`. */
  suggestions?: readonly unknown[];
  defaultToNo?: boolean;
}

/** Sent on (re)connect: the run's state plus the session's complete blocks. */
export interface SnapshotPayload {
  state: SessionState;
  /** Complete messages only — buffered deltas are collapsed, never replayed. */
  blocks: readonly SDKMessage[];
  pendingApprovals: readonly ApprovalRequestPayload[];
  lastSeq: number;
}

export type StreamStatus = 'turn_started' | 'turn_ended' | 'interrupted';

/** Turn boundaries are backend events, so they cannot come from an SDK message. */
export interface StreamStatusPayload {
  status: StreamStatus;
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
    | { kind: 'stream_status'; payload: StreamStatusPayload }
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
}

export interface SetPermissionModePayload {
  mode: PermissionMode;
}

/** `continue` needs no id (most recent session in the cwd); `fork` branches the history. */
export type ResumePayload = { mode: 'continue' } | { sessionId: string; fork?: boolean };

export type ClientMessage = ClientMessageBase &
  (
    | { type: 'send_prompt'; payload: SendPromptPayload }
    | { type: 'interrupt'; payload: InterruptPayload }
    | { type: 'clear_resume'; payload: ClearResumePayload }
    | { type: 'approval_response'; payload: ApprovalResponsePayload }
    | { type: 'set_permission_mode'; payload: SetPermissionModePayload }
    | { type: 'resume'; payload: ResumePayload }
  );
