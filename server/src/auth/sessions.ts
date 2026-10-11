import { randomBytes } from 'node:crypto';

import type { Principal } from '@clodeck/shared';

/**
 * The server-side session store (spec-05 §Session store): the cookie is an
 * opaque key into this map and nothing else.
 *
 * No signing, no JWT (decision 07): a session ends by *deletion* — a logout, a
 * restart — rather than by a claim that could outlive the server's memory. The
 * `SessionStore` interface is what a Redis/DB implementation swaps behind later;
 * the in-memory map is the only implementation this slice ships.
 */

/** The idle window: seven days, slid on every use (spec-05 §Session store). */
export const DEFAULT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 random bytes — a token with no structure to guess or forge. */
const TOKEN_BYTES = 32;

export interface Session {
  /** The cookie value: an opaque CSPRNG token, never a claim about the principal. */
  id: string;
  principal: Principal;
  /** Epoch ms. Slides forward on every read; an expired entry is dropped on read. */
  expiresAt: number;
}

export interface SessionStore {
  /** The session, with its idle window slid forward — or `undefined` (and dropped) when expired. */
  get(id: string): Session | undefined;
  create(principal: Principal): Session;
  destroy(id: string): void;
}

export interface SessionStoreOptions {
  /** The idle window. Defaults to {@link DEFAULT_IDLE_MS}. */
  idleMs?: number;
  /** The clock. Injectable so sliding-idle and expiry are deterministic in tests. */
  now?: () => number;
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;

  const sessions = new Map<string, Session>();

  return {
    get(id) {
      const session = sessions.get(id);
      if (session === undefined) return undefined;

      const at = now();
      // Dropped, not filtered: a stale token is gone for good, so a clock that
      // moves backwards cannot resurrect a session that already lapsed.
      if (session.expiresAt <= at) {
        sessions.delete(id);
        return undefined;
      }

      // Sliding idle: using a session is what keeps it alive.
      session.expiresAt = at + idleMs;
      return session;
    },

    create(principal) {
      const session: Session = {
        id: randomBytes(TOKEN_BYTES).toString('base64url'),
        principal,
        expiresAt: now() + idleMs,
      };
      sessions.set(session.id, session);
      return session;
    },

    destroy(id) {
      // Idempotent on purpose: a logout with an unknown or already-expired
      // cookie still has to clear the cookie and answer 200.
      sessions.delete(id);
    },
  };
}
