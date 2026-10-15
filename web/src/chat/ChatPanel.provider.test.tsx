// @vitest-environment jsdom
import type { ProviderProfileSummary, Project } from '@clodeck/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const project: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };

const PROFILES: ProviderProfileSummary[] = [
  { name: 'default', model: 'claude-opus-5-5' },
  { name: 'FAST', model: 'claude-haiku-5-5' },
];

/**
 * The one socket the panel opens, with `send` recorded as parsed frames. It
 * starts in the browser's `OPEN` state and is opened by the test, which is what
 * lets the composer be usable without a server.
 */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly instances: FakeSocket[] = [];
  readonly sent: unknown[] = [];
  readonly readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(frame: string): void {
    this.sent.push(JSON.parse(frame) as unknown);
  }

  close(): void {
    // Nothing to tear down: there is no server on the other end of this.
  }

  /** The upgrade succeeded. */
  open(): void {
    this.onopen?.();
  }

  /** Whatever the server would say next. */
  deliver(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

/** The socket the panel most recently opened. */
function latestSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error('the panel opened no socket');
  return socket;
}

/** `{ profiles }` with the two fields a profile is allowed to have. */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  FakeSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  // The panel also fetches the project's sessions on mount; a 404 leaves that in
  // its error state, which is not what this file is about.
  vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
    String(input).includes('/api/profiles')
      ? Promise.resolve(jsonResponse({ profiles: PROFILES }))
      : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  );
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
    render(<ChatPanel project={project} />);
    act(() => {
      latestSocket().open();
    });

    // Nothing remembered in this browser, so the session opens on the server's
    // own environment — the reserved default, in its own words.
    await screen.findByRole('button', { name: 'running on server environment · claude-opus-5-5' });

    choose('FAST · claude-haiku-5-5');
    expect(trigger('running on FAST · claude-haiku-5-5')).toBeTruthy();

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
    const first = render(<ChatPanel project={project} />);
    await screen.findByRole('button', { name: /^running on/ });
    choose('FAST · claude-haiku-5-5');
    first.unmount();

    render(<ChatPanel project={project} />);

    await screen.findByRole('button', { name: 'running on FAST · claude-haiku-5-5' });
  });

  it('shuts the picker once a turn has run, and says so', async () => {
    render(<ChatPanel project={project} />);
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

    const locked = trigger('running on server environment · claude-opus-5-5');
    expect(locked).toHaveProperty('disabled', true);

    fireEvent.click(locked);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
