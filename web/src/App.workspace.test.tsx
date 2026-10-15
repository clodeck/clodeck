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

/**
 * The workspace at one project state. `loading` is the third one because a
 * create and a refresh both pass through it, and the rail has to survive that
 * window (ticket 57) — a `loading` state carries no list to pass.
 */
function workspace(
  selectedId: string | null,
  projects: Project[] = [projectA, projectB],
  status: 'ready' | 'loading' = 'ready',
): ReactElement {
  return (
    <Workspace
      state={status === 'loading' ? { status: 'loading' } : { status: 'ready', projects }}
      selectedId={selectedId}
      onSelect={noop}
      onRefresh={noop}
      onCreate={() => Promise.resolve()}
      onLogout={() => Promise.resolve()}
    />
  );
}

/** Whether a rail button is shut for want of a project (ticket 57). */
function unavailable(name: string): boolean {
  return screen.getByRole('button', { name }).hasAttribute('disabled');
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

/**
 * The rail *before* a project is chosen (ticket 57). The drawer lives inside the
 * stage and is built from a project, so a tab recorded with none selected could
 * never be drawn: the click did nothing visible, and the drawer then opened
 * later, after a selection the user had stopped thinking about. That recording
 * is deliberately gone — the tests below pin both the refusal and how narrow it
 * is, because everything else in this window (the stage's own sentence, the
 * sidebar, the shut Chat) must read exactly as it did.
 */
describe('the rail with no project selected', () => {
  it('refuses Terminal and Files when the root holds no projects at all', () => {
    render(workspace(null, []));

    expect(unavailable('Terminal')).toBe(true);
    expect(unavailable('Files')).toBe(true);
  });

  it('refuses them just the same with projects waiting and none chosen', () => {
    render(workspace(null));

    expect(unavailable('Terminal')).toBe(true);
    expect(unavailable('Files')).toBe(true);
  });

  it('says why on the control, rather than leaving a dead click to explain it', () => {
    render(workspace(null, []));

    const files = screen.getByRole('button', { name: 'Files' });
    expect(files.getAttribute('title')).toContain('choose a project first');
    // The control takes no pointer events while it is disabled, so its own title
    // is never shown to a mouse: the wrapper is what the pointer actually
    // reaches, and the reason has to be on both to reach both readers.
    expect(files.parentElement?.getAttribute('title')).toContain('choose a project first');
    // Chat has nothing to explain, so its name is its whole title.
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('title')).toBe('Chat');
  });

  it('leaves Chat live: a shut drawer is a state, not a project', () => {
    render(workspace(null, []));

    const chat = screen.getByRole('button', { name: 'Chat' });
    expect(chat.hasAttribute('disabled')).toBe(false);
    expect(chat.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(chat);

    // Nothing is invented in its place — no placeholder drawer, no empty shell.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Select a project to begin.')).toBeDefined();
  });

  it('does not remember a refused click for the project that arrives later', () => {
    const { rerender } = render(workspace(null));

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    rerender(workspace('AAA'));

    // No tab was recorded, so the first project does not land with the drawer
    // already open on a choice made before that project existed.
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('hands both buttons back as soon as a project is selected', () => {
    const { rerender } = render(workspace(null));
    expect(unavailable('Terminal')).toBe(true);

    rerender(workspace('AAA'));

    expect(unavailable('Terminal')).toBe(false);
    expect(unavailable('Files')).toBe(false);
    // Enabled means it works, not merely that it stopped looking shut.
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true');
  });
});

/**
 * The other window an id-less rail is *not*: the round trip a create and a
 * refresh both make. The id is chosen and the list is in flight, so the project
 * it names cannot be resolved yet. Deriving the rail from the resolved project
 * alone shut it for that whole round trip — and a create goes straight into it,
 * so the rail died at the exact moment a project was born.
 */
describe('the rail while the list is in flight', () => {
  it('stays live on the strength of the id, so a create does not shut it', () => {
    const { rerender } = render(workspace('AAA', [projectA, projectB], 'loading'));
    expect(unavailable('Files')).toBe(false);

    // The click is not dropped on the floor: the tab is recorded, and the drawer
    // it chose is there the moment the list lands.
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    rerender(workspace('AAA'));

    expect(screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true');
  });

  it('refuses again when the id never resolves into a project', () => {
    const { rerender } = render(workspace('AAA', [projectA], 'loading'));
    expect(unavailable('Files')).toBe(false);

    // The project went away under the refresh. An id that names nothing is not a
    // project, so the rail shuts rather than promising a drawer it cannot draw.
    rerender(workspace('AAA', [projectB]));

    expect(unavailable('Files')).toBe(true);
  });

  it('still refuses with no id at all, which is ticket 57’s window', () => {
    render(workspace(null, [], 'loading'));

    expect(unavailable('Terminal')).toBe(true);
    expect(unavailable('Files')).toBe(true);
  });
});
