// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILES, jsonResponse, project } from '../testing/chat-fixtures';
import { FakeSocket, forgetSockets, latestSocket } from '../testing/fake-socket';
import { ToastProvider } from '../toast/ToastProvider';
import { ChatPanel } from './ChatPanel';

/**
 * The client half of "a session runs on a profile I pick, end to end": the pick
 * the user makes beside the composer is the profile the turn goes out on.
 *
 * The socket is a fake and the profile list is a stubbed response, because
 * neither is what this file is about — what it pins is the wiring between them:
 * the picker's line, the frame's payload, and what the *next* session in the
 * project opens on.
 */

/** Every URL the panel asked for, in order. */
const fetched: string[] = [];

beforeEach(() => {
  window.localStorage.clear();
  forgetSockets();
  fetched.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  // The panel also fetches the project's sessions on mount; a 404 leaves that in
  // its error state, which is not what this file is about.
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return String(input).includes('/profiles')
      ? Promise.resolve(jsonResponse({ profiles: PROFILES, pinned: false }))
      : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

/** The picker's trigger, once the list has arrived. */
function trigger(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/** Choose a profile through the control, the way a user does. */
function choose(option: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^running on/ }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('the provider a turn is sent on', () => {
  it('sends the prompt on the profile the picker is showing, and never on an older one', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    act(() => {
      latestSocket().open();
    });

    // Nothing remembered in this browser, so the session opens on the server's
    // own environment — the reserved default, in its own words.
    await screen.findByRole('button', { name: 'running on claude-opus-5-5 · server environment' });

    choose('claude-haiku-5-5 · FAST');
    expect(trigger('running on claude-haiku-5-5 · FAST')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const socket = latestSocket();
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'send_prompt',
      payload: { prompt: 'hello', profile: 'FAST' },
    });
    // The name, and nothing else about the provider: the endpoint and the
    // credential are not the browser's to send.
    expect(Object.keys(socket.sent.at(-1) as object).sort()).toEqual(['id', 'payload', 'type', 'v']);
  });

  it('opens the project’s next session on the profile this one chose', async () => {
    const first = render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    await screen.findByRole('button', { name: /^running on/ });
    choose('claude-haiku-5-5 · FAST');
    first.unmount();

    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);

    await screen.findByRole('button', { name: 'running on claude-haiku-5-5 · FAST' });
  });

  it('shuts the picker once a turn has run, and says so', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    await screen.findByRole('button', { name: /^running on/ });

    // The run's own snapshot: a turn in flight, which is the server's word that
    // this session has a provider already.
    act(() => {
      latestSocket().deliver({
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        projectId: project.id,
        kind: 'snapshot',
        payload: { state: 'running', blocks: [], pendingApprovals: [], lastSeq: 0 },
      });
    });

    const locked = trigger('running on claude-opus-5-5 · server environment');
    expect(locked).toHaveProperty('disabled', true);

    fireEvent.click(locked);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not shut the picker on a send the server refused', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    act(() => {
      latestSocket().open();
    });
    await screen.findByRole('button', { name: /^running on/ });

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    // The refusal the lock has to survive: nothing ran, so this session still has
    // no profile of its own — and the error tells the user to change the control,
    // which must not have shut itself on the way.
    act(() => {
      latestSocket().deliver({
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        projectId: project.id,
        kind: 'error',
        payload: { code: 'unknown_profile', message: 'no profile named GONE' },
      });
    });

    expect(trigger('running on claude-opus-5-5 · server environment')).toHaveProperty('disabled', false);
  });

  it('asks what this project may choose, since a pin is the project’s and not the deployment’s', async () => {
    render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);
    await screen.findByRole('button', { name: /^running on/ });

    // The one answer a deployment-wide list could not give: whether this project
    // pins its own endpoint and credential (ADR 0002).
    expect(fetched).toContain(`/api/projects/${project.id}/profiles`);
  });
});
