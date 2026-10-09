import type { ContentBlock } from './sdk.js';

/**
 * Session-history contracts — what the server reads back out of the Agent SDK's
 * on-disk transcripts (wayfinder 06 §4/§5).
 *
 * History has no store of its own: the SDK's `~/.claude/projects/<cwd>/<id>.jsonl`
 * is the single source of truth and the server keeps no session database, so
 * these two shapes are the entire persistence contract.
 *
 * They sit beside the live `SDKMessage` mirror because history and live share
 * one block renderer: a transcript replays the same `ContentBlock`s a live
 * `assistant`/`user` message carries, and only the wrapper around them differs.
 */

/**
 * One row of the session picker. Fields the UI does not need yet (`fileSize`,
 * `cwd`, `gitBranch`) are deliberately absent — adding one later is a
 * normalization change, not a model change (wayfinder 06 §4).
 */
export interface SessionSummary {
  /** The SDK `session_id`. There is no parallel id (wayfinder 06 §2). */
  id: string;
  /**
   * Already resolved by the provider (`customTitle` → `summary` → `firstPrompt`
   * → `"Untitled"`), so the client never re-derives a display title.
   */
  title: string;
  /** ISO 8601. The SDK reports epoch milliseconds, which are not portable as-is. */
  createdAt?: string;
  /** ISO 8601. The list arrives ordered by this, descending — the SDK's own order. */
  lastModified?: string;
  tag?: string;
}

/**
 * One turn of a transcript. `role` has no `system` arm: the SDK's own
 * `SessionMessage` also carries system rows (compact boundaries, notices), but
 * those are not turns and the provider drops them before normalizing.
 */
export interface SessionMessage {
  role: 'user' | 'assistant';
  /**
   * Complete blocks only — history is static, so it never contains the
   * `stream_event` deltas a live turn streams (wayfinder 06 §5).
   */
  content: readonly ContentBlock[];
  /**
   * The tool call this entry is about: a `tool_use` block's `id`, or the
   * `tool_use_id` a `tool_result` block answers.
   */
  toolUseId?: string;
  /** Set on a subagent frame, which the client nests under that tool card. */
  parentToolUseId?: string;
}
