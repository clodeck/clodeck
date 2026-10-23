// @vitest-environment jsdom
import type { ApprovalRequestPayload, PermissionMode } from '@clodeck/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILES, jsonResponse, project } from '../testing/chat-fixtures';
import { FakeSocket, forgetSockets, latestSocket } from '../testing/fake-socket';
import { ToastProvider } from '../toast/ToastProvider';
import { ChatPanel } from './ChatPanel';

/**
 * The modal's third answer (ticket 96): "Always allow Bash" is offered only on
 * the gate clodeck raised, it rides the approval response, and the badge beside
 * the composer is where the grant is seen — and taken back.
 */

/** A frame as the server stamps it. */
function frame(kind: string, payload: unknown): unknown {
  return {
    v: 1,
    seq: 2,
    ts: new Date().toISOString(),
    projectId: project.id,
    kind,
    payload,
  };
}

/** The snapshot that opens a connection, carrying the run's approvals. */
function snapshot(
  pendingApprovals: readonly ApprovalRequestPayload[] = [],
  bashAllowedForSession = false,
): unknown {
  return frame('snapshot', {
    state: pendingApprovals.length > 0 ? 'requires_action' : 'idle',
    permissionMode: 'default' as PermissionMode,
    bypass: { allowed: true },
    bashAllowedForSession,
    blocks: [],
    pendingApprovals,
    lastSeq: 0,
  });
}

const BASH_REQUEST: ApprovalRequestPayload = {
  requestId: 'req-1',
  toolUseID: 'tool-1',
  toolName: 'Bash',
  input: { command: 'sed -i s/a/b/ notes.txt' },
  decisionReason: 'Bash commands always ask for approval in this mode.',
  canAllowBashForSession: true,
};

beforeEach(() => {
  window.localStorage.clear();
  forgetSockets();
  vi.stubGlobal('WebSocket', FakeSocket);
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
  cleanup();
  vi.unstubAllGlobals();
});

/** Mount the panel with its socket open and the run's snapshot delivered. */
function openWith(view: unknown): void {
  render(
    <ToastProvider>
      <ChatPanel project={project} />
    </ToastProvider>,
  );
  act(() => {
    latestSocket().open();
  });
  act(() => {
    latestSocket().deliver(view);
  });
}

describe('the session allow in the approval modal', () => {
  it('offers it on clodeck’s Bash gate and sends it as the answer', () => {
    openWith(snapshot([BASH_REQUEST]));

    const offer = screen.getByRole('button', { name: 'Always allow Bash' });
    fireEvent.click(offer);

    expect(latestSocket().lastSent()).toMatchObject({
      type: 'approval_response',
      payload: { requestId: 'req-1', behavior: 'allow', allowBashForSession: true },
    });
  });

  it('offers nothing when the server did not put it on the request', () => {
    // A prompt a project's `ask` rule opened, or any other tool: the run cannot
    // honour the grant there, so the surface must not promise it.
    openWith(snapshot([{ ...BASH_REQUEST, canAllowBashForSession: false }]));

    expect(screen.queryByRole('button', { name: 'Always allow Bash' })).toBeNull();
    // The two answers the modal always had are still there.
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });
});

describe('the session allow badge', () => {
  it('shows when the run grants it, and takes it back when clicked', () => {
    openWith(snapshot());

    expect(screen.queryByText('Bash always allowed')).toBeNull();

    act(() => {
      latestSocket().deliver(frame('session_allow', { bash: true }));
    });
    expect(screen.getByText('Bash always allowed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop always allowing Bash' }));
    expect(latestSocket().lastSent()).toMatchObject({ type: 'clear_bash_session_allow' });

    // The run's word is what hides it: the clear is acknowledged, not assumed.
    expect(screen.getByText('Bash always allowed')).toBeTruthy();
    act(() => {
      latestSocket().deliver(frame('session_allow', { bash: false }));
    });
    expect(screen.queryByText('Bash always allowed')).toBeNull();
  });

  it('comes back on a reconnect whose snapshot carries the grant', () => {
    openWith(snapshot([], true));

    expect(screen.getByText('Bash always allowed')).toBeTruthy();
  });
});
