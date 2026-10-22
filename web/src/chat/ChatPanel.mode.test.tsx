// @vitest-environment jsdom
import type { PermissionMode } from '@clodeck/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILES, jsonResponse, project } from '../testing/chat-fixtures';
import { FakeSocket, forgetSockets, latestSocket } from '../testing/fake-socket';
import { ToastProvider } from '../toast/ToastProvider';
import { ChatPanel } from './ChatPanel';

/**
 * The client half of "the composer picks the mode, and the run keeps it"
 * (ticket 82): the chip is wired to the run, not to a client preference.
 *
 * An idle choice is *not* a frame — it rides the next `send_prompt`, so the mode
 * and the prompt it belongs to leave together. A mid-turn choice is a frame of
 * its own, because the run is already going. And a snapshot is where the truth
 * comes back from after either.
 */

/** A frame as the server stamps it. */
function frame(kind: string, payload: unknown, sessionId?: string): unknown {
  return {
    v: 1,
    seq: 2,
    ts: new Date().toISOString(),
    projectId: project.id,
    ...(sessionId === undefined ? {} : { sessionId }),
    kind,
    payload,
  };
}

/** The snapshot that opens a connection, with the mode the run reports. */
function snapshot(
  state: 'idle' | 'running',
  permissionMode: PermissionMode,
  sessionId?: string,
  bypass = { allowed: true },
): unknown {
  return frame(
    'snapshot',
    { state, permissionMode, bypass, blocks: [], pendingApprovals: [], lastSeq: 0 },
    sessionId,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  forgetSockets();
  vi.stubGlobal('WebSocket', FakeSocket);
  // The panel also fetches the project's profiles and sessions on mount; only
  // the profiles answer matters to the send path.
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/profiles')) {
      return Promise.resolve(jsonResponse({ profiles: PROFILES, pinned: false }));
    }
    if (url.includes('/sessions')) {
      return Promise.resolve(jsonResponse({ sessions: [] }));
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

/** Open the panel's socket and hand it a snapshot of the run. */
function openWith(
  state: 'idle' | 'running',
  permissionMode: PermissionMode,
  bypass?: { allowed: boolean; reason?: string },
): void {
  act(() => {
    latestSocket().open();
  });
  act(() => {
    latestSocket().deliver(snapshot(state, permissionMode, undefined, bypass));
  });
}

/** Pick `label` from the mode chip, the way a user does. */
function choose(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^(Ask|Accept edits|Plan|Bypass)$/ }));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('the mode a turn is sent on', () => {
  it('shows the mode a reconnect restores from the run’s snapshot', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('idle', 'plan');

    // The browser has no mode of its own: the run's snapshot is where a
    // reconnecting client learns what the session is actually in.
    await screen.findByRole('button', { name: 'Plan' });
  });

  it('sends an idle choice with the next prompt, not as a frame of its own', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('idle', 'default');

    choose('Accept edits');
    expect(screen.getByRole('button', { name: 'Accept edits' })).toBeTruthy();
    // There is no turn to tell: a `set_permission_mode` here would be answered
    // with no_active_turn, so the choice waits for the send that starts one.
    expect(latestSocket().sent).toEqual([]);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(latestSocket().lastSent()).toMatchObject({
      type: 'send_prompt',
      payload: { prompt: 'hello', profile: 'default', permissionMode: 'acceptEdits' },
    });
  });

  it('switches a running turn at once, and stays open for the next switch', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('running', 'default');

    choose('Plan');

    // A live run is told now — the rest of its turn runs in the new mode — and
    // the chip already says so.
    expect(latestSocket().lastSent()).toMatchObject({
      type: 'set_permission_mode',
      payload: { mode: 'plan' },
    });
    const trigger = screen.getByRole('button', { name: 'Plan' });
    expect(trigger).toHaveProperty('disabled', false);

    // Unlike the provider, a turn does not lock it: the next turn can be a
    // different kind of work.
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).not.toBeNull();
  });

  it('returns to the server’s default when a New chat’s snapshot arrives', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('idle', 'plan');

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(latestSocket().lastSent()).toMatchObject({ type: 'clear_resume' });

    // The reset is the server's: the snapshot it broadcasts carries the mode
    // the next session starts in, which is what the chip shows.
    act(() => {
      latestSocket().deliver(snapshot('idle', 'default'));
    });
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
  });
});

/**
 * Bypass in the composer (ticket 85): the confirmation is the client's half of
 * the gate, and the badge is the other — a warning that cannot be dismissed is
 * what "while Bypass is active" means.
 */
describe('Bypass in the composer', () => {
  it('switches a running turn only after the confirmation', () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('running', 'default');

    choose('Bypass');
    // The dialog is up and nothing has been sent: choosing Bypass is two clicks.
    expect(latestSocket().sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Bypass' }));

    expect(latestSocket().lastSent()).toMatchObject({
      type: 'set_permission_mode',
      payload: { mode: 'bypassPermissions' },
    });
  });

  it('keeps the badge up while Bypass is active, and takes it down on a switch', () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('idle', 'default');

    expect(screen.queryByText(/every tool runs without asking/i)).toBeNull();

    choose('Bypass');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Bypass' }));
    expect(screen.getByText(/Bypass — every tool runs without asking/i)).toBeTruthy();

    // The next mode change is what ends the warning: nothing else dismisses it.
    choose('Plan');
    expect(screen.queryByText(/every tool runs without asking/i)).toBeNull();
  });

  it('does not offer Bypass when the snapshot’s gates refuse it', () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('idle', 'default', { allowed: false, reason: 'CLODECK_ALLOW_BYPASS is off.' });

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const option = screen.getByRole('option', { name: 'Bypass' });
    expect(option).toHaveProperty('disabled', true);
    expect(screen.getByText('CLODECK_ALLOW_BYPASS is off.')).toBeTruthy();
  });

  it('shows the SDK’s own words when a Bypass turn is refused', () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    openWith('running', 'bypassPermissions');

    // The root/sudo refusal is the SDK's, and it fails the turn rather than
    // falling back to a quieter mode: the reason is the one thing the user needs,
    // so the subtype alone is not enough (ticket 85).
    act(() => {
      latestSocket().deliver(
        frame('sdk', {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'S1',
          is_error: true,
          errors: ['Cannot use bypass permissions mode when running as root'],
          num_turns: 1,
          stop_reason: null,
          modelUsage: {},
          total_cost_usd: 0,
          duration_ms: 5,
        }),
      );
    });

    expect(screen.getByText(/Turn failed \(error_during_execution\)/)).toBeTruthy();
    expect(screen.getByText(/running as root/)).toBeTruthy();
  });
});
