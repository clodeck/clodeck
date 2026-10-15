import type {
  ApprovalRequestPayload,
  ApprovalResponsePayload,
  PermissionMode,
  ResolvedProvider,
  SDKMessage,
  SessionMessage,
  SessionSummary,
} from '@clodeck/shared';

/**
 * The provider facade (spec-02 §"SDK provider facade"): everything the rest of
 * the server wants from the Agent SDK, said in shared types.
 *
 * Nothing here imports `@anthropic-ai/claude-agent-sdk`. That dependency lives
 * behind this interface — only `./anthropic.ts` (the real provider) and
 * `../testing/` (the scripted fake) touch it — so `tsc` keeps the SDK out of
 * every module that merely *uses* a session, and the automated suites run
 * against the fake with no API key and no network.
 */

/**
 * One approval round-trip. Deliberately the envelope's own payloads (wayfinder
 * 04 §2): the bus callback, the provider callback and the wire payload are one
 * shape, so an approval crosses the whole stack without a translation.
 */
export type ApprovalCallback = (
  request: ApprovalRequestPayload,
) => Promise<ApprovalResponsePayload>;

export interface SdkRunInput {
  /** Always a canonical project path from `resolveProject()` — never a raw id. */
  cwd: string;
  prompt: string;
  /** Resume a specific SDK session id. */
  resume?: string;
  /** With `resume`: branch the history into a new session instead of continuing it. */
  forkSession?: boolean;
  /** Resume the most recent session in `cwd`, with no id to remember. */
  continueLatest?: boolean;
  /** Defaults to `'default'` at the real provider (gated tools ask through `canUseTool`). */
  permissionMode?: PermissionMode;
  /**
   * The provider this run executes on, already resolved. Absent means the
   * server's own environment — the reserved **default** profile, and the only
   * behaviour there was before a run could choose one.
   */
  provider?: ResolvedProvider;
  canUseTool?: ApprovalCallback;
  signal?: AbortSignal;
}

/** One `query()` call: the mirrored message stream plus the live controls. */
export interface SdkRun {
  /** The shared mirror — the real provider drops the SDK families the client does not render. */
  messages: AsyncIterable<SDKMessage>;
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

export interface SdkProvider {
  query(input: SdkRunInput): SdkRun;
  /** `dir` is a canonical project path; the SDK store is ordered `lastModified` desc. */
  listSessions(dir: string): Promise<SessionSummary[]>;
  getSessionMessages(sessionId: string, dir: string): Promise<SessionMessage[]>;
}
