// @vitest-environment jsdom
import type { BuildStamp } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginScreen, type LoginScreenProps } from './LoginScreen';

/**
 * The notice on the one screen the password is typed on (ticket 62).
 *
 * The rule behind it has its own suite beside it (`origin.test.ts`); what is
 * pinned here is the rendering — the notice is on screen on a bare origin and
 * absent where there is no risk — and the negative half that matters just as
 * much: it gates nothing. The origin is passed in rather than read from
 * `location`, so each case is a string instead of a served page.
 *
 * The notice's own copy is the query on purpose: a reader arriving at a failed
 * assertion should see the sentence the screen carries, not a test id.
 */

const NOTICE = /not encrypted/i;

/** A login that is never refused; the shell's half is not what this file is about. */
const accepts: LoginScreenProps['login'] = async () => ({ ok: true });

/** A login the server refuses — the form's own path, with the notice sitting above it. */
const refuses: LoginScreenProps['login'] = async () => ({
  ok: false,
  reason: 'invalid',
  message: 'invalid password',
});

function renderLogin(
  origin: string,
  login: LoginScreenProps['login'] = accepts,
  build: BuildStamp | null = null,
): void {
  render(<LoginScreen login={login} origin={origin} build={build} />);
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
});

describe('the login screen', () => {
  it('carries the notice on a plain-HTTP origin outside the loopback set', () => {
    renderLogin('http://203.0.113.10:3001');

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('carries no notice on https, or on loopback however it is spelled', () => {
    for (const origin of [
      'https://203.0.113.10:3001',
      'https://clodeck.example.com',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://[::1]:3001',
    ]) {
      renderLogin(origin);
      expect(screen.queryByText(NOTICE), origin).toBeNull();
      cleanup();
    }
  });

  it('gates nothing: the notice is drawn, and the form behind it is unchanged', async () => {
    const login = vi.fn(refuses);
    renderLogin('http://203.0.113.10:3001', login);

    expect(screen.getByText(NOTICE)).toBeTruthy();

    // The password field and the button behave exactly as they always did: no
    // login without a password, and the attempt is what the field holds.
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    expect(button).toHaveProperty('disabled', false);

    fireEvent.click(button);
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('hunter2');
    });

    // A refusal still reads as itself, and the notice it appeared under is
    // still there — the warning is context, not a second thing to dismiss.
    expect((await screen.findByRole('alert')).textContent).toBe('invalid password');
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });
});

/**
 * The running build, before anyone has signed in (ticket 94). The line is the
 * same one the sidebar header draws; what is pinned here is that this screen
 * carries it, and that each of the three states reads as itself rather than as
 * a commit-shaped mask.
 */
describe('the build stamp on the login screen', () => {
  const SHA = 'fcbd770000000000000000000000000000000000';
  // Constructed in local time so the expectation is 14:05 on every machine:
  // the screen formats `builtAt` in the browser's own zone, by design.
  const BUILT_AT = new Date(2026, 9, 23, 14, 5).toISOString();

  it('shows the commit and its local build time, with the full SHA in title', () => {
    renderLogin('https://clodeck.example.com', accepts, { commit: SHA, builtAt: BUILT_AT, dirty: false });

    const line = screen.getByTitle(SHA);
    expect(line.textContent).toBe('fcbd770 · 2026-10-23 14:05');
  });

  it('marks an unclean tree with -dirty rather than hiding it', () => {
    renderLogin('https://clodeck.example.com', accepts, { commit: SHA, builtAt: BUILT_AT, dirty: true });

    expect(screen.getByTitle(SHA).textContent).toBe('fcbd770-dirty · 2026-10-23 14:05');
  });

  it('shows dev and unknown as themselves, with no build time', () => {
    for (const commit of ['dev', 'unknown']) {
      renderLogin('https://clodeck.example.com', accepts, { commit, builtAt: null, dirty: false });

      const line = screen.getByTitle(commit);
      expect(line.textContent).toBe(commit);
      cleanup();
    }
  });

  it('draws nothing while the stamp is still being read', () => {
    renderLogin('https://clodeck.example.com');

    expect(screen.queryByTitle(/dev|unknown/)).toBeNull();
  });
});
