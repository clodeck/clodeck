// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Workspace } from './App';
import { stubBrowserForXterm } from './testing/xterm-jsdom';

/**
 * The workspace's panel keys, reached the way a user reaches them: through the
 * rail and into the bottom drawer.
 *
 * This is the seam a terminal bug hid behind: `TerminalPanel.test.tsx` renders
 * the panel *alone*, so it can never see a key collision — and a collision is
 * precisely what happened, because the grid rendered `TerminalPanel` and
 * `FilePanel` as siblings with the *same* key. React warns that non-unique keys
 * "may cause children to be duplicated and/or omitted", and its key map keeps
 * only one entry per key, so the first sibling fell out of its bookkeeping and
 * was never unmounted: every project switch left the old terminal on screen and
 * appended a new one below it.
 *
 * `Workspace` takes the project state as a prop, so a switch here is what a
 * switch is in the app — `selectedId` changes and the keyed panels inside
 * reconcile against the old ones — with no network and no login.
 */

const projectA: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };
const projectB: Project = { id: 'BBB', name: 'hello', path: '/projects/hello' };

function noop(): void {
  // The layout's callbacks are not what this file is about.
}

function workspace(selectedId: string | null): ReactElement {
  return (
    <Workspace
      state={{ status: 'ready', projects: [projectA, projectB] }}
      selectedId={selectedId}
      onSelect={noop}
      onRefresh={noop}
      onLogout={() => Promise.resolve()}
    />
  );
}

beforeEach(() => {
  stubBrowserForXterm();
  // The chat and file panels fetch on mount; a 404 leaves them in their error
  // state, which is irrelevant to how many terminals the drawer is holding.
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  );
});

afterEach(() => {
  // The suite runs without vitest globals, so testing-library never registers
  // its own auto-cleanup: without this the second render here would stack on
  // top of the first and every query would match two workspaces.
  cleanup();
  vi.unstubAllGlobals();
});

describe('the workspace drawer', () => {
  it('leaves exactly one terminal on screen after switching projects', () => {
    const { baseElement, rerender } = render(workspace('AAA'));
    const terminals = (): number => baseElement.querySelectorAll('.xterm').length;

    // Shut on first load: the chat has the whole stage and no shell is spawned.
    expect(terminals()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(terminals()).toBe(1);
    expect(screen.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true');

    rerender(workspace('BBB'));

    // The symptom, exactly: one terminal replaces the other, never two.
    expect(terminals()).toBe(1);
    // The drawer's tab is workspace state, so the switch did not close it.
    expect(screen.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true');
  });

  it('is one choice: Chat closes it, and the rail says which one is active', () => {
    const { baseElement } = render(workspace('AAA'));
    const pressed = (name: string): string | null =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed');

    expect(pressed('Chat')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(baseElement.querySelectorAll('.xterm').length).toBe(0);
    expect(screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true');
    expect(pressed('Files')).toBe('true');
    expect(pressed('Chat')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(pressed('Chat')).toBe('true');
  });
});
