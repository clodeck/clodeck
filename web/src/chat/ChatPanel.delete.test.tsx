// @vitest-environment jsdom
import type { SDKMessage } from '@clodeck/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILES, jsonResponse, project } from '../testing/chat-fixtures';
import { FakeSocket, forgetSockets, latestSocket } from '../testing/fake-socket';
import { ToastProvider } from '../toast/ToastProvider';
import { ChatPanel } from './ChatPanel';
import { TURN_RUNNING } from './reasons';

/**
 * Deleting a stored session from History (ticket 79): a hard delete of the
 * transcript on disk, confirmed first, and the live chat's own half taken with
 * it when the deleted conversation is the one on screen.
 *
 * The socket is the shared fake and REST is stubbed, as in the chat's other
 * suites: what this file pins is what the surface asks the server to do and how
 * each answer — success, a refusal, a cancel — changes the panel.
 */

/** The one stored session these tests delete, and the title History knows it by. */
const SESSION = '00000000-0000-4000-8000-0000000000aa';
const TITLE = 'Fix the login screen';

/** One turn already behind the chat, so there is a transcript to take away. */
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

/** The snapshot that opens a connection: the run's state and its buffered blocks. */
function snapshot(
  blocks: readonly SDKMessage[],
  state: 'idle' | 'running' = 'idle',
  sessionId?: string,
): unknown {
  return frame('snapshot', { state, blocks, pendingApprovals: [], lastSeq: 0 }, sessionId);
}

/** What the list route currently answers. */
let listed: { id: string; title: string }[] = [];
/** Every DELETE the panel sent, in order. */
const deletes: string[] = [];
/** What the next DELETE answers — a refusal is set by the test that is about one. */
let deleteAnswer: { ok: true } | { ok: false; status: number; error: string } = { ok: true };

beforeEach(() => {
  window.localStorage.clear();
  forgetSockets();
  listed = [{ id: SESSION, title: TITLE }];
  deletes.length = 0;
  deleteAnswer = { ok: true };

  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === 'DELETE') {
      deletes.push(url);
      const answer = deleteAnswer;
      if (!answer.ok) {
        return Promise.resolve({
          ok: false,
          status: answer.status,
          statusText: 'Conflict',
          json: () => Promise.resolve({ error: answer.error }),
        });
      }
      listed = [];
      return Promise.resolve({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: () => Promise.resolve({}),
      });
    }

    if (url.includes('/profiles')) {
      return Promise.resolve(jsonResponse({ profiles: PROFILES, pinned: false }));
    }
    if (url.endsWith('/sessions')) {
      return Promise.resolve(jsonResponse({ sessions: listed }));
    }
    if (url.includes('/messages')) {
      return Promise.resolve(jsonResponse({ messages: [] }));
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
});

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the panel with its socket open — a live chat with no server behind it. */
function renderLive(): FakeSocket {
  render(
    <ToastProvider>
      <ChatPanel project={project} />
    </ToastProvider>,
  );
  act(() => {
    latestSocket().open();
  });
  return latestSocket();
}

/** Open History and the row action this file is about. */
async function deleteRow(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  return await screen.findByRole('button', { name: `Delete ${TITLE}` });
}

/** The confirmation the row action opens. */
async function confirmDialog(): Promise<HTMLElement> {
  return await screen.findByRole('dialog', { name: 'Confirm session delete' });
}

/** Press the dialog's own Delete. */
function confirmDelete(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

describe('deleting a session from History', () => {
  it('asks for a confirmation that says the transcript is gone for good, and Cancel deletes nothing', async () => {
    renderLive();

    fireEvent.click(await deleteRow());
    const dialog = await confirmDialog();
    expect(dialog.textContent).toContain('deleted from disk for good');
    expect(dialog.textContent).toContain('no longer be resumed');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Confirm session delete' })).toBeNull();
    expect(deletes).toEqual([]);
    expect(screen.getByRole('button', { name: `Delete ${TITLE}` })).toBeTruthy();
  });

  it('removes the row and toasts once the server accepts', async () => {
    renderLive();

    fireEvent.click(await deleteRow());
    confirmDelete(await confirmDialog());

    await waitFor(() => {
      expect(deletes).toEqual([`/api/projects/${project.id}/sessions/${SESSION}`]);
    });
    expect(screen.queryByRole('button', { name: `Delete ${TITLE}` })).toBeNull();
    expect(await screen.findByText(`deleted ${TITLE}`)).toBeTruthy();
  });

  it('is shut for the session a live turn is writing, with the reason on it', async () => {
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot([], 'running', SESSION));
    });

    const button = await deleteRow();
    expect(button).toHaveProperty('disabled', true);
    // A disabled control gets no pointer events, so its own `title` never
    // becomes a tooltip — the reason rides the wrapper as well (ticket 57).
    expect(button.getAttribute('title')).toBe(TURN_RUNNING);
    expect(button.closest('span')?.getAttribute('title')).toBe(TURN_RUNNING);
  });

  it('takes the live chat with it when the deleted session is the current one', async () => {
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot(transcript(SESSION), 'idle', SESSION));
    });
    await screen.findByText('On it.');

    fireEvent.click(await deleteRow());
    confirmDelete(await confirmDialog());

    // The transcript, the identity and the server's buffer go together: the
    // existing `newChat` is the one reset, so a deleted session cannot be
    // resumed by the next send.
    await screen.findByText('new chat');
    expect(screen.queryByText('On it.')).toBeNull();
    expect(socket.lastSent()).toMatchObject({ type: 'clear_resume', payload: {} });
  });

  it('clears an armed resume target when that session is deleted', async () => {
    const socket = renderLive();
    // A transcript on screen, but the run named none: the row's Resume is what
    // makes this session the armed target, not the chat's identity.
    act(() => {
      socket.deliver(snapshot(transcript(SESSION), 'idle'));
    });
    await screen.findByText('On it.');

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(screen.getByText(/The next message continues/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: `Delete ${TITLE}` }));
    confirmDelete(await confirmDialog());

    await waitFor(() => {
      expect(screen.queryByText(/The next message continues/)).toBeNull();
    });
    // The banner is the client's mirror; the bus holds the same target, and
    // only `clear_resume` takes that one away.
    expect(socket.lastSent()).toMatchObject({ type: 'clear_resume', payload: {} });
  });

  it('keeps the dialog open with the server’s reason when it refuses', async () => {
    deleteAnswer = {
      ok: false,
      status: 409,
      error: 'turn_in_progress: a turn is running — interrupt it, or wait for it to finish',
    };
    const socket = renderLive();
    act(() => {
      socket.deliver(snapshot(transcript(SESSION), 'idle', SESSION));
    });
    await screen.findByText('On it.');

    fireEvent.click(await deleteRow());
    const dialog = await confirmDialog();
    confirmDelete(dialog);

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('turn_in_progress');
    // Nothing was reset or removed: the session is still on disk and on screen.
    expect(screen.getByRole('button', { name: `Delete ${TITLE}` })).toBeTruthy();
    expect(screen.getByText('On it.')).toBeTruthy();
    expect(socket.sent.some((sent) => (sent as { type?: string }).type === 'clear_resume')).toBe(false);
  });
});
