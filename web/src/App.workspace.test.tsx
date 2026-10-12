// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspacePlaceholder } from './App';
import { stubBrowserForXterm } from './testing/xterm-jsdom';

/**
 * The workspace's panel grid, where the panels' keys live.
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
 * Switching `project` here is what `Shell` does — `WorkspacePlaceholder` is not
 * itself keyed, so a new project arrives as a prop change and the keyed panels
 * inside reconcile against the old ones.
 */

const projectA: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };
const projectB: Project = { id: 'BBB', name: 'hello', path: '/projects/hello' };

beforeEach(() => {
  stubBrowserForXterm();
  // The chat and file panels fetch on mount; a 404 leaves them in their error
  // state, which is irrelevant to how many terminals the grid is holding.
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the workspace panel grid', () => {
  it('leaves exactly one terminal on screen after switching projects', () => {
    const { baseElement, rerender } = render(<WorkspacePlaceholder project={projectA} />);
    const terminals = () => baseElement.querySelectorAll('.xterm').length;

    expect(terminals()).toBe(1);

    rerender(<WorkspacePlaceholder project={projectB} />);

    // The symptom, exactly: one terminal replaces the other, never two.
    expect(terminals()).toBe(1);
  });
});
