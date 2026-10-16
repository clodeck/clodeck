// @vitest-environment jsdom
import type { SDKMessage } from '@clodeck/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILES, jsonResponse, project } from '../testing/chat-fixtures';
import { FakeSocket, forgetSockets, latestSocket } from '../testing/fake-socket';
import { ChatPanel } from './ChatPanel';

/**
 * Which session the chat is in, and the door out of it (ticket 74).
 *
 * Three facts, one subject: the header says which session this is and reads it
 * off the server's envelope; `New chat` drops it — here and on the bus — so the
 * next send starts one of its own; and the picker, which is what a new session
 * is *for*, is free again once it has.
 *
 * The socket is the shared fake and the REST answers are stubs, because none of
 * them is what this file is about: what it pins is what the surface says and
 * which frames it sends.
 */

/** The session the run named, and the title History knows it by. */
const SESSION = '00000000-0000-4000-8000-0000000000aa';
const TITLE = 'Fix the login screen';

/** One turn already behind it, so the surface has a transcript to throw away. */
function transcript(sessionId: string): SDKMessage[] {
  return [
    {
      type: 'assistant',
      session_id: sessionId,
      parent_tool_use_id: null,
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'On it.' }] },
    },
  ];
}

/** A frame as the server stamps it: the run's session on the envelope when it names one. */
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

/** The snapshot that opens a connection: the run's state and the blocks it has buffered. */
function snapshot(
  blocks: readonly SDKMessage[],
  state: 'idle' | 'running' = 'idle',
  sessionId?: string,
): unknown {
  return frame('snapshot', { state, blocks, pendingApprovals: [], lastSeq: 0 }, sessionId);
}

/** How many times the project's session list has been asked for, in order. */
let listReads = 0;
/** What that list answers — the store, which this chat's session is written to *after* mount. */
let listed: { id: string; title: string }[] = [];

beforeEach(() => {
  window.localStorage.clear();
  forgetSockets();
  listReads = 0;
  listed = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/profiles')) {
      return Promise.resolve(jsonResponse({ profiles: PROFILES, pinned: false }));
    }
    if (url.includes('/sessions')) {
      listReads += 1;
      return Promise.resolve(jsonResponse({ sessions: listed }));
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

const NEW_CHAT = 'New chat';
const NEW_CHAT_BLOCKED = 'a turn is running — interrupt it, or wait for it to finish';

function newChatButton(): HTMLElement {
  return screen.getByRole('button', { name: NEW_CHAT });
}

/** Render the panel with its socket open — a live chat with no server behind it. */
function renderLive(): FakeSocket {
  render(<ChatPanel project={project} />);
  act(() => {
    latestSocket().open();
  });
  return latestSocket();
}

describe('the session a chat is in', () => {
  it('is a new chat until the server names one, then the title History knows it by', async () => {
    const socket = renderLive();

    // Nothing has been sent, so there is no session to name — and the header says
    // exactly that rather than inventing one.
    expect(screen.getByText('new chat')).toBeTruthy();
    // The list was read at mount, when this chat's session did not exist yet.
    expect(listReads).toBe(1);

    // The server's own word for which session this is: the envelope, on a frame
    // with no block that could have carried it. The session is on disk by now —
    // naming one is what makes the read above stale.
    listed = [{ id: SESSION, title: TITLE }];
    act(() => {
      socket.deliver(frame('stream_status', { status: 'turn_started' }, SESSION));
    });

    const identity = await screen.findByTitle(`${TITLE} · ${SESSION}`);
    expect(identity.textContent).toBe(TITLE);
    // Asked again, because the session it has to name has only just been written.
    expect(listReads).toBe(2);
    expect(screen.queryByText('new chat')).toBeNull();

    // And the same string the list itself draws, from the one source both read; a
    // title is not unique, which is why the id rides the tooltip beside it.
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(
      (await screen.findByRole('button', { name: new RegExp(TITLE) })).textContent,
    ).toContain(TITLE);
  });

  it('leaves the picker free while a resume is armed, since no turn has run in that chat', async () => {
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot([], 'idle'));
    });
    await screen.findByRole('button', { name: /^running on/ });

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: /Continue latest/ }));
    expect(screen.getByText(/The next message continues/)).toBeTruthy();

    // Arming a target is not a turn, and the model belongs to the run: the send
    // that continues that session may still run on whichever profile this chat is
    // set to, so the control that chooses it stays open.
    expect(
      screen.getByRole('button', { name: 'running on claude-opus-5-5 · server environment' }),
    ).toHaveProperty('disabled', false);
  });

  it('is what Resume continues — never a bare continue-latest', async () => {
    renderLive();
    act(() => {
      latestSocket().deliver(frame('stream_status', { status: 'turn_started' }, SESSION));
    });
    // A turn the user is expected to continue from, whose own payload names no
    // session either: the header's identity is what Resume can act on.
    act(() => {
      latestSocket().deliver(
        frame(
          'sdk',
          {
            type: 'result',
            subtype: 'error_max_turns',
            session_id: SESSION,
            is_error: true,
            errors: ['too many turns'],
            num_turns: 5,
            stop_reason: 'max_turns',
            total_cost_usd: 0.03,
            duration_ms: 10,
          },
          SESSION,
        ),
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    // Degrading to `{ mode: 'continue' }` here would resume whichever session the
    // SDK happens to consider latest, which need not be this one.
    expect(latestSocket().lastSent()).toMatchObject({
      type: 'resume',
      payload: { sessionId: SESSION },
    });
  });
});

describe('the new chat button', () => {
  it('clears the transcript, the identity, the banner and the history surface, and tells the bus', async () => {
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot(transcript(SESSION), 'idle', SESSION));
    });
    await screen.findByText('On it.');

    // A resume armed, and History open on it: the two things a new chat has to
    // take back with it.
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: /Continue latest/ }));
    expect(screen.getByText(/The next message continues/)).toBeTruthy();

    fireEvent.click(newChatButton());

    expect(screen.getByText('Send a prompt to start the session.')).toBeTruthy();
    expect(screen.queryByText('On it.')).toBeNull();
    expect(screen.queryByText(/The next message continues/)).toBeNull();
    expect(screen.queryByLabelText('Session history')).toBeNull();
    expect(screen.getByText('new chat')).toBeTruthy();

    // And the server's half, which the surface cannot reach: the armed target and
    // the buffered transcript it would otherwise hand back on the next reconnect.
    expect(socket.lastSent()).toMatchObject({ type: 'clear_resume', payload: {} });
  });

  it('is shut while a turn is running, with the reason on it', async () => {
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot([], 'running'));
    });

    const button = newChatButton();
    expect(button).toHaveProperty('disabled', true);
    // A disabled control gets no pointer events, so its own `title` never becomes
    // a tooltip — the reason rides the wrapper as well (the rail's rule, ticket 57).
    expect(button.getAttribute('title')).toBe(NEW_CHAT_BLOCKED);
    expect(button.closest('span')?.getAttribute('title')).toBe(NEW_CHAT_BLOCKED);
  });

  it('stays open while a resume is armed — it is the way out of one', async () => {
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot(transcript(SESSION), 'idle', SESSION));
    });
    await screen.findByText('On it.');

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: /Continue latest/ }));

    const button = newChatButton();
    expect(button).toHaveProperty('disabled', false);

    fireEvent.click(button);

    // Ticket 11's gap: until this button there was no way to drop an armed target
    // but the send that consumed it.
    expect(screen.queryByText(/The next message continues/)).toBeNull();
    expect(socket.lastSent()).toMatchObject({ type: 'clear_resume' });
  });

  it('frees the picker, which is still on the profile this project chose', async () => {
    const socket = renderLive();
    await screen.findByRole('button', { name: /^running on/ });

    // The choice, made while this session has run nothing.
    fireEvent.click(screen.getByRole('button', { name: 'running on claude-opus-5-5 · server environment' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /FAST/ }));
    const chosen = screen.getByRole('button', { name: 'running on claude-haiku-5-5 · FAST' });
    expect(chosen).toHaveProperty('disabled', false);

    // A turn behind it, so this session's profile is set and the picker shuts.
    act(() => {
      socket.deliver(snapshot(transcript(SESSION), 'idle', SESSION));
    });
    expect(screen.getByRole('button', { name: 'running on claude-haiku-5-5 · FAST' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.click(newChatButton());

    // What the lock says to start is what this is, and the profile it opens on is
    // the one this project last used — not the default it fell back to (ticket 68).
    expect(screen.getByRole('button', { name: 'running on claude-haiku-5-5 · FAST' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});
