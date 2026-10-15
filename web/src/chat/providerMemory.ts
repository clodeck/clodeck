/**
 * Which profile this browser last chose for a project.
 *
 * The choice itself is client state and stays here: clodeck writes no file and
 * keeps no store, so nothing on the server knows what a session ran on beyond
 * the line each run logs. What the browser keeps is narrower than that — the
 * *choice*, per project, so a new session in a project opens on the profile the
 * last one used instead of defaulting every time, which is the whole
 * cheap-for-grunt-work / strong-for-design workflow
 * (`.scratch/clodeck/issues/68-session-runs-on-a-profile.md`, the user's
 * decision of 2026-10-15).
 *
 * It is deliberately not a claim about the past. A reload forgets what the run
 * in flight is doing, and the surface says what is running **now** rather than
 * what a session *is* — so what is read back is the next send's profile, which
 * is the only thing the browser honestly knows.
 */

/** One key per project, namespaced so a later choice cannot collide with anything else stored. */
const KEY_PREFIX = 'clodeck.provider.';

/**
 * The browser's own store, or null where a browser will not give one up — a
 * privacy mode, storage disabled, a sandboxed frame. Null is not an error here:
 * a project with no memory simply opens on the default profile.
 */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The profile remembered for `projectId`, or null when the browser has none —
 * the state that means *default* to the caller.
 */
export function readRememberedProfile(storage: Storage | null, projectId: string): string | null {
  if (storage === null) return null;

  try {
    const remembered = storage.getItem(KEY_PREFIX + projectId);
    return remembered === null || remembered === '' ? null : remembered;
  } catch {
    // A store that refuses to be read is a store with nothing in it.
    return null;
  }
}

/**
 * Remember `name` for `projectId`, replacing whatever was there — the last
 * choice for a project is the only one worth carrying forward.
 *
 * A store that refuses the write is not reported: the memory is a convenience,
 * and the session it would have started on a different profile still works.
 */
export function rememberProfile(storage: Storage | null, projectId: string, name: string): void {
  if (storage === null) return;

  try {
    storage.setItem(KEY_PREFIX + projectId, name);
  } catch {
    // Full, forbidden, or a store that only reads — nothing to do about it.
  }
}
