import type { ServerEvent } from '@clodeck/shared';

/**
 * A `ServerEvent` before the transport adds the two per-connection fields:
 * `seq` (the socket's own counter) and `ts` (stamped at send time). The turn
 * manager and the bus build drafts; only the emitter stamps — so the same draft
 * can fan out to two sockets, each with its own sequence.
 */
type WithoutConnectionFields<T> = T extends unknown ? Omit<T, 'seq' | 'ts'> : never;

export type EventDraft = WithoutConnectionFields<ServerEvent>;

export type EmitDraft = (draft: EventDraft) => void;
