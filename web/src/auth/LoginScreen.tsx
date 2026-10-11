import { useState, type FormEvent, type ReactElement } from 'react';

import type { LoginRefusal, LoginResult } from './transport';

/**
 * The login screen — the whole shell's front door (spec-05 §"Shared + web
 * client"). One password field, no username: there is one account.
 *
 * It owns the *attempt* (the field, the in-flight state, the message), and
 * nothing about the session: the moment a login succeeds the parent swaps this
 * component out, so the success path deliberately sets no state of its own.
 */

export interface LoginScreenProps {
  /** Attempt a login. Resolves with the refusal, or with `ok` when the shell takes over. */
  login: (password: string) => Promise<LoginResult>;
}

type Attempt =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'refused'; reason: LoginRefusal; message: string };

export function LoginScreen({ login }: LoginScreenProps): ReactElement {
  const [password, setPassword] = useState('');
  const [attempt, setAttempt] = useState<Attempt>({ status: 'idle' });

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
      </form>
    </div>
  );
}
