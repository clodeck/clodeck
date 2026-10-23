import type { BuildStamp } from '@clodeck/shared';
import { useState, type FormEvent, type ReactElement } from 'react';

import { BuildStampLine } from '../BuildStamp';
import { isCleartextOrigin } from './origin';
import type { LoginRefusal, LoginResult } from './transport';

/**
 * The login screen — the whole shell's front door (spec-05 §"Shared + web
 * client"). One password field, no username: there is one account.
 *
 * It owns the *attempt* (the field, the in-flight state, the message), and
 * nothing about the session: the moment a login succeeds the parent swaps this
 * component out, so the success path deliberately sets no state of its own.
 *
 * It also carries the one moment the direct route's cost is real — the password
 * about to cross the network (spec-07 §"The warnings"). The rule lives in
 * `origin.ts`; this only draws what it decides.
 */

export interface LoginScreenProps {
  /** Attempt a login. Resolves with the refusal, or with `ok` when the shell takes over. */
  login: (password: string) => Promise<LoginResult>;
  /**
   * The origin this page was loaded from. Defaults to the browser's own, and is
   * only ever passed explicitly by a test — the notice is about where *this*
   * browser is, never a configured host.
   */
  origin?: string;
  /**
   * The running build, drawn before anyone signs in (ticket 94). `null` while
   * `/healthz` is still in flight, or when the caller passed none at all.
   */
  build?: BuildStamp | null;
}

type Attempt =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'refused'; reason: LoginRefusal; message: string };

export function LoginScreen({
  login,
  origin = window.location.origin,
  build = null,
}: LoginScreenProps): ReactElement {
  const [password, setPassword] = useState('');
  const [attempt, setAttempt] = useState<Attempt>({ status: 'idle' });

  const cleartext = isCleartextOrigin(origin);
  const busy = attempt.status === 'busy';
  // A refused 401 is the user's to fix; a lockout and a server failure are not,
  // so they read differently rather than as one red banner.
  const locked = attempt.status === 'refused' && attempt.reason === 'locked';

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || password === '') return;

    setAttempt({ status: 'busy' });
    const result = await login(password);
    // On success this component is already gone — the shell replaced it.
    if (!result.ok) setAttempt({ status: 'refused', reason: result.reason, message: result.message });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-canvas px-4 text-ink">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-sm">
        <h1 className="text-sm font-semibold">Clodeck</h1>
        <p className="mt-1 text-[11px] text-ink-dim">Sign in to reach your projects.</p>
        {/* The same line the sidebar header carries: after a deploy the
            question "which commit is this?" is asked before signing in as
            often as after, and the answer is on this screen too (ticket 94). */}
        <BuildStampLine build={build} className="mt-1 font-mono text-[11px] text-ink-dim" />

        <label className="mt-6 block text-[11px] font-semibold tracking-wider text-ink-dim uppercase" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          disabled={busy || locked}
          onChange={(event) => {
            setPassword(event.target.value);
            // Typing is an attempt to fix it: clear the last refusal.
            setAttempt({ status: 'idle' });
          }}
          className="mt-2 w-full rounded border border-line bg-panel px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={busy || locked || password === ''}
          className="mt-3 w-full rounded border border-line bg-panel px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {attempt.status === 'refused' && (
          <p className={`mt-3 text-xs ${locked ? 'text-ink-dim' : 'text-err'}`} role="alert">
            {locked ? 'Too many failed attempts. Wait a few minutes and try again.' : attempt.message}
          </p>
        )}

        {/* Discreet by design, and below the refusal rather than above it: the
            refusal answers the click just made, and this is standing context
            about the address. It explains and nothing else — the direct route
            stays usable, with no box to tick (decision 12). */}
        {cleartext && (
          <p className="mt-3 text-[11px] text-ink-dim">
            This connection is not encrypted, so your password crosses the network in the clear.
          </p>
        )}
      </form>
    </div>
  );
}
