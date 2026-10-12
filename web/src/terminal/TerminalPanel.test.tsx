// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubBrowserForXterm } from '../testing/xterm-jsdom';
import { TerminalPanel } from './TerminalPanel';

/**
 * The real xterm over a jsdom DOM, so the assertion is the actual `.xterm` count
 * in the document — not the seam's own bookkeeping.
 *
 * Scope, learned the hard way: this panel *alone* can only prove that a key
 * change on it disposes its own instance. It cannot see a key *collision* with a
 * sibling, which is the bug that was actually reported — for that, see
 * `App.workspace.test.tsx`, which renders the grid the keys live in.
 */

beforeEach(() => {
  stubBrowserForXterm();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const projectA: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };
const projectB: Project = { id: 'BBB', name: 'hello', path: '/projects/hello' };

describe('TerminalPanel remount on project switch', () => {
  it('leaves exactly one xterm in the document after switching projects', () => {
    const { baseElement, rerender } = render(
      <StrictMode>
        <TerminalPanel key="AAA" project={projectA} />
      </StrictMode>,
    );

    const count = () => baseElement.querySelectorAll('.xterm').length;
    expect(count()).toBe(1);

    rerender(
      <StrictMode>
        <TerminalPanel key="BBB" project={projectB} />
      </StrictMode>,
    );

    expect(count()).toBe(1);
  });
});
