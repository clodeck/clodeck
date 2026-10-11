import type { Principal } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

import { fetchMe, login as loginRequest, logout as logoutRequest, type LoginResult } from './transport';

/**
 * The auth seam (spec-05 §"Shared + web client"), mirroring `useProjects`: the
 * shell asks one hook whether there is a session, and no panel or socket is
 * mounted until it says yes.
 *
 * `checking` is a state of its own — distinct from `unauthenticated` — so the
 * shell never flashes a login form at a session that already exists.
 *
 * There is no `error` state on purpose: the trio is what `App` gates on, and a
 * `/me` that cannot be interpreted *is* "no session we can act on" — the form is
 * the recovery path either way (see `transport.ts`).
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthQuery {
  status: AuthStatus;
  /** The principal behind the session, or `null` while there is none. */
  principal: Principal | null;
  /** Attempt a login. A refusal comes back as a result, not a throw. */
  login: (password: string) => Promise<LoginResult>;
  /** End the session. Always resolves — see below. */
  logout: () => Promise<void>;
}

/**
 * The hook's own state is the two fields together, kept as a union so
 * "authenticated with no principal" cannot be represented; the returned shape
 * is the flat one the seam pins.
 */
type Session =
  | { status: 'checking' }
  | { status: 'authenticated'; principal: Principal }
  | { status: 'unauthenticated' };

export function useAuth(): AuthQuery {
  const [session, setSession] = useState<Session>({ status: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    // The cookie is the only thing that answers this; the shell owns nothing
    // until the server says who the request is.
    fetchMe(controller.signal).then(
      (principal) => {
        if (controller.signal.aborted) return;
        setSession(principal === null ? { status: 'unauthenticated' } : { status: 'authenticated', principal });
      },
      () => {
        // An aborted request is this effect being replaced; anything else is a
        // server we cannot read, which is not a state to keep the shell in.
        if (!controller.signal.aborted) setSession({ status: 'unauthenticated' });
      },
    );

    return () => controller.abort();
  }, []);

  const login = useCallback(async (password: string): Promise<LoginResult> => {
    const result = await loginRequest(password);
    if (!result.ok) return result;

    // The login response says "you are in" and nothing more, so the principal
    // is read from the session it just created rather than assumed here: the
    // client's idea of who it is stays derived from the server.
    const principal = await fetchMe().catch(() => null);
    setSession(principal === null ? { status: 'unauthenticated' } : { status: 'authenticated', principal });
    return result;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutRequest();
    } catch {
      // A logout that failed to reach the server is still a browser done with
      // the shell. Swallowed deliberately: the caller is a button, and the
      // server remains the authority on whether the cookie is still a session
      // (the next gated call is what finds out).
    }
    setSession({ status: 'unauthenticated' });
  }, []);

  return {
    status: session.status,
    principal: session.status === 'authenticated' ? session.principal : null,
    login,
    logout,
  };
}
