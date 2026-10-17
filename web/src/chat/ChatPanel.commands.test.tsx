// @vitest-environment jsdom
import type { SlashCommand } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILES, jsonResponse, project } from '../testing/chat-fixtures';
import { FakeSocket, forgetSockets, latestSocket } from '../testing/fake-socket';
import { ChatPanel } from './ChatPanel';

/**
 * Where the composer's `/` menu gets its list (ticket 75).
 *
 * The menu has two sources and one rule between them: the **run** is the
 * authority the moment it has reported a list — it knows Claude Code's own
 * commands, and no file on disk declares those — and the **project's files**
 * answer until then, because before the first send there is no run to ask.
 *
 * The socket and the REST answers are stubs, as in the chat's other suites:
 * what this file pins is which source the panel offers and when it asks again,
 * not what either source contains.
 */

/** What the project's own files declare — the answer `GET …/commands` gives. */
const ON_DISK: SlashCommand[] = [{ name: 'local-skill', description: 'From the project’s files.' }];

/** What a started run reports: the same project command *and* a built-in. */
const FROM_RUN: SlashCommand[] = [
  { name: 'local-skill', description: 'From the project’s files.' },
  { name: 'code-review', description: 'Review the diff.', builtin: true },
];

/** How many times the command route has been asked, in order. */
let commandReads = 0;

/** A frame as the server stamps it. */
function frame(kind: string, payload: unknown): unknown {
  return { v: 1, seq: 2, ts: new Date().toISOString(), projectId: project.id, kind, payload };
}

/** Type into the box the way a user does: the value, and the caret after it. */
function type(text: string): void {
  const box = screen.getByLabelText('Message');
  fireEvent.change(box, { target: { value: text } });
  if (box instanceof HTMLTextAreaElement) {
    box.setSelectionRange(text.length, text.length);
    fireEvent.select(box);
  }
}

/** The rows the open menu is drawing. */
function rows(): string[] {
  return screen.getAllByRole('option').map((row) => row.querySelector('span')?.textContent ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
  forgetSockets();
  commandReads = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/commands')) {
      commandReads += 1;
      return Promise.resolve(jsonResponse({ commands: ON_DISK }));
    }
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

/** The panel with its socket open, which is the only state the menu opens in. */
async function openChat(): Promise<FakeSocket> {
  render(<ChatPanel project={project} />);
  const socket = latestSocket();
  socket.open();
  await screen.findByText('Live');
  return socket;
}

describe('the commands the menu offers', () => {
  it('offers the project’s own files before any run exists', async () => {
    await openChat();

    type('/');

    // There is no run to ask yet — the run is lazy, so nothing has been sent and
    // no session has listed anything — so the answer is the files on disk.
    expect(rows()).toEqual(['/local-skill']);
    expect(screen.getByText('From the project’s files.')).toBeTruthy();
  });

  it('reads the route again every time the menu opens', async () => {
    const socket = await openChat();
    expect(commandReads).toBe(1); // the chat's own mount

    type('/');
    await vi.waitFor(() => {
      expect(commandReads).toBe(2);
    });

    // Esc shut it, then a fresh `/`: a skill installed while this chat was open
    // is a command nobody has told the client about.
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Escape' });
    type('');
    type('/');
    await vi.waitFor(() => {
      expect(commandReads).toBe(3);
    });

    // …and the socket is not what the list is read over.
    expect(socket.sent).toEqual([]);
  });

  it('prefers the run’s own list once a run has reported one', async () => {
    const socket = await openChat();
    type('/');
    await vi.waitFor(() => {
      expect(commandReads).toBe(2);
    });
    expect(rows()).toEqual(['/local-skill']);

    // The run's list, pushed as it starts. It contains the project's command too
    // — the run is the authority on *everything* it can dispatch — and the
    // built-ins, which no file on disk declares.
    socket.deliver(frame('commands', { commands: FROM_RUN }));
    await vi.waitFor(() => {
      expect(rows()).toEqual(['/code-review', '/local-skill']);
    });

    // And a later replacement still wins over the files, which were never
    // re-read: the run stays the authority for the rest of its life.
    socket.deliver({
      ...(frame('sdk', {
        type: 'system',
        subtype: 'commands_changed',
        session_id: 's1',
        commands: [{ name: 'only-now', builtin: true }],
      }) as Record<string, unknown>),
    });
    await vi.waitFor(() => {
      expect(rows()).toEqual(['/only-now']);
    });
  });

  it('opens on the run’s list after a reconnect, without waiting for a send', async () => {
    await openChat();

    // A snapshot is the whole state of the run, and the command list is part of
    // it — it never travelled as a message, so a reconnect is the only place it
    // could have been lost.
    latestSocket().deliver(
      frame('snapshot', { state: 'idle', blocks: [], pendingApprovals: [], commands: FROM_RUN, lastSeq: 0 }),
    );

    type('/');

    expect(rows()).toEqual(['/code-review', '/local-skill']);
  });
});
