import type { Principal } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { createSessionStore } from './sessions.js';

/**
 * The session store's behavior, driven through an injected clock: sliding idle
 * and expiry are wall-clock behavior, so a test that waits for them would be
 * slow and flaky. The clock *is* the seam (spec-05 §Testing).
 */
describe('the session store', () => {
  const PRINCIPAL: Principal = { id: 'default', name: 'default' };

  /** A store on a hand-held clock, so every expiry is exact. */
  function clocked(idleMs: number): { store: ReturnType<typeof createSessionStore>; at: (ms: number) => void } {
    let now = 0;
    return {
      store: createSessionStore({ idleMs, now: () => now }),
      at: (ms) => {
        now = ms;
      },
    };
  }

  it('creates a session for a principal, expiring one idle window from now', () => {
    const { store } = clocked(1000);

    const session = store.create(PRINCIPAL);

    expect(session.principal).toEqual(PRINCIPAL);
    expect(session.expiresAt).toBe(1000);
    expect(store.get(session.id)).toBe(session);
  });

  it('mints an opaque token, not a value that names anything', () => {
    const { store } = clocked(1000);

    const session = store.create(PRINCIPAL);

    // URL-safe base64 of 32 random bytes: the cookie is a key into the store,
    // never a signed claim about the principal.
    expect(session.id).toMatch(/^[A-Za-z0-9_-]+={0,2}$/);
    expect(Buffer.from(session.id, 'base64url')).toHaveLength(32);
    expect(session.id).not.toContain(PRINCIPAL.id);
  });

  it('mints a distinct token per session', () => {
    const { store } = clocked(1000);

    const ids = new Set([store.create(PRINCIPAL).id, store.create(PRINCIPAL).id, store.create(PRINCIPAL).id]);

    expect(ids.size).toBe(3);
  });

  it('defaults to a seven-day idle window', () => {
    const store = createSessionStore({ now: () => 0 });

    expect(store.create(PRINCIPAL).expiresAt).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('answers undefined for a token it never minted', () => {
    const { store } = clocked(1000);

    expect(store.get('never-issued')).toBeUndefined();
  });

  it('slides the window on every use', () => {
    const { store, at } = clocked(1000);
    const session = store.create(PRINCIPAL);

    at(900);
    expect(store.get(session.id)?.expiresAt).toBe(1900);

    // Past the original expiry — kept alive by the first read.
    at(1500);
    expect(store.get(session.id)).toBeDefined();
    expect(store.get(session.id)?.expiresAt).toBe(2500);

    // One past the slid window, with no read in between: gone.
    at(3501);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('drops an expired session on read, rather than filtering it out', () => {
    const { store, at } = clocked(1000);
    const session = store.create(PRINCIPAL);

    at(1000);
    // Exactly at expiry is already expired: the window is idle time, not a clock tick.
    expect(store.get(session.id)).toBeUndefined();

    // Rewinding the clock must not resurrect it — the entry was dropped, not
    // merely reported as stale.
    at(0);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('destroys a session and tolerates a token that names nothing', () => {
    const { store } = clocked(1000);
    const session = store.create(PRINCIPAL);

    store.destroy(session.id);
    expect(store.get(session.id)).toBeUndefined();

    expect(() => {
      store.destroy('never-issued');
    }).not.toThrow();
  });

  it('keeps sessions independent of each other', () => {
    const { store } = clocked(1000);
    const first = store.create(PRINCIPAL);
    const second = store.create({ id: 'other', name: 'other' });

    store.destroy(first.id);

    expect(store.get(first.id)).toBeUndefined();
    expect(store.get(second.id)?.principal.id).toBe('other');
  });
});
