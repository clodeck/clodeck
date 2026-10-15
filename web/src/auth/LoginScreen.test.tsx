// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginScreen, type LoginScreenProps } from './LoginScreen';
import type { LoginResult } from './transport';

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
const accepts: LoginScreenProps['login'] = () => Promise.resolve({ ok: true });

async function refuses(): Promise<LoginResult> {
  return { ok: false, reason: 'invalid', message: 'invalid password' };
}

function renderLogin(origin: string, login: LoginScreenProps['login'] = accepts): void {
  render(<LoginScreen login={login} origin={origin} />);
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
