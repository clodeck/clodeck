import type { Principal } from '@clodeck/shared';

/**
 * The auth REST layer: `login` / `logout` / `me`, and the status mapping that
 * decides what the login screen says. Kept apart from `useAuth` exactly as the
 * terminal's and the file drawer's `transport.ts` are kept apart from their
 * hooks — no React, so it is testable under the node test environment.
 *
 * The session itself never appears here: the cookie is httpOnly and the browser
 * attaches it to these same-origin calls (and to the same-origin `/ws` and
 * `/ws/terminal` upgrades) with no client code at all. There is nothing to
 * store, read or send back.
 */

const BASE = '/api/auth';

/**
 * Why a login was refused. Exported because it is the UI's switch, not the
 * transport's private detail: a wrong password is the user's to fix, a lockout
 * is time, and anything else is the server's problem.
 */
export type LoginRefusal = 'invalid' | 'locked' | 'failed';

/** What a login attempt came to. */
export type LoginResult = { ok: true } | { ok: false; reason: LoginRefusal; message: string };

/**
 * `POST /api/auth/login`. A network failure is a `failed` result rather than a
 * throw: the one caller is a form, and a form that throws mid-submit is a form
 * that never re-renders.
 */
export async function login(password: string): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch (error) {
    return { ok: false, reason: 'failed', message: messageOf(error) };
  }

  if (response.ok) return { ok: true };

  const message = await failureMessage(response);
  if (response.status === 401) return { ok: false, reason: 'invalid', message };
  if (response.status === 429) return { ok: false, reason: 'locked', message };
  return { ok: false, reason: 'failed', message };
}

/**
 * `GET /api/auth/me` — the principal behind the cookie, or `null` when there is
 * no session. A `401` is the ordinary "not logged in" answer, not a failure; a
 * status we cannot interpret *throws*, so a broken server is not silently
 * rendered as an empty login form.
 */
export async function fetchMe(signal?: AbortSignal): Promise<Principal | null> {
  const response = await fetch(`${BASE}/me`, { signal, headers: { accept: 'application/json' } });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isPrincipalEnvelope(body)) throw new Error('unexpected response shape');
  return body.principal;
}

/**
 * `POST /api/auth/logout` — end the session server-side and clear the cookie.
 * Exempt and idempotent on the server, so this only fails when the server
 * itself cannot be reached; the caller decides what to do about that.
 */
export async function logout(): Promise<void> {
  const response = await fetch(`${BASE}/logout`, { method: 'POST' });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/**
 * The server's REST error shape is `{ error }`; a non-JSON body falls back to
 * the status line. The same idiom as `useSessions.ts` and `files/transport.ts`.
 */
async function failureMessage(response: Response): Promise<string> {
  const status = `${String(response.status)} ${response.statusText}`.trim();
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === 'string') return `${status}: ${error}`;
    }
  } catch {
    // A non-JSON body falls back to the status line.
  }
  return status;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The contract is compile-time; the wire is not. One guard at the boundary
 * turns a drifted body into an error instead of a broken shell.
 */
function isPrincipalEnvelope(body: unknown): body is { principal: Principal } {
  if (typeof body !== 'object' || body === null) return false;
  const principal = (body as { principal?: unknown }).principal;
  if (typeof principal !== 'object' || principal === null) return false;

  const candidate = principal as Partial<Record<keyof Principal, unknown>>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string';
}
