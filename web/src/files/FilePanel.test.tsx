// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilePanel } from './FilePanel';

/**
 * The file panel's layout, over the real `useFiles` seam: the tree column and
 * the code column are siblings of one row, and the open file lands in the code
 * column — not under the tree, as the pre-drawer stack had it.
 *
 * jsdom computes no layout, so "side by side" cannot be measured; what is
 * asserted instead is the structure that carries it — two direct children of one
 * row-flex section, the first of them the fixed-width tree.
 */

const project: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };

const FILE_BODY = 'const answer = 42;';

/** One file endpoint, one root listing, and nothing else. */
function stubFiles(): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input), 'http://localhost');
    const body = pathname.endsWith('/files/content')
      ? { content: { kind: 'text', content: FILE_BODY, truncated: false, size: FILE_BODY.length } }
      : {
          entries: [
            { type: 'directory', name: 'src' },
            { type: 'file', name: 'README.md', size: FILE_BODY.length, mtime: '2026-10-12T00:00:00.000Z' },
          ],
        };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

/** One of the panel's two columns, by position. */
function column(panel: Element, index: number): HTMLElement {
  const child = panel.children[index];
  if (child === undefined) throw new Error(`the Files panel has no column ${String(index)}`);
  return child as HTMLElement;
}

describe('FilePanel in the drawer', () => {
  it('is a 300px tree column beside a code column, and opens a file into the code column', async () => {
    stubFiles();
    const { container } = render(<FilePanel project={project} />);

    const panel = container.querySelector('section[aria-label="Files"]');
    expect(panel).not.toBeNull();
    if (panel === null) throw new Error('no Files panel');
    const tree = column(panel, 0);
    const code = column(panel, 1);

    // Two columns, siblings — neither nested inside the other.
    expect(panel.children).toHaveLength(2);
    expect(tree.contains(code)).toBe(false);
    expect(code.contains(tree)).toBe(false);
    expect(panel?.className).toContain('flex');
    expect(panel?.className).not.toContain('flex-col');
    expect(tree.className).toContain('w-[300px]');
    expect(code.className).toContain('flex-1');

    // The tree column owns the toolbar and the breadcrumb; the code column is
    // empty (its head says so) until a file is opened.
    expect(tree.contains(screen.getByRole('button', { name: 'New File' }))).toBe(true);
    expect(code.contains(screen.getByText('no file selected'))).toBe(true);

    // The tree's own listing lands in the tree column...
    const readme = await screen.findByRole('button', { name: 'README.md' });
    expect(tree.contains(readme)).toBe(true);
    expect(code.contains(readme)).toBe(false);

    fireEvent.click(readme);

    // ...and the bytes it opens land in the code column, under its path.
    const body = await screen.findByText(FILE_BODY);
    expect(code.contains(body)).toBe(true);
    expect(tree.contains(body)).toBe(false);
    // The code head shows the path the bytes belong to.
    expect(within(code).getByText('README.md')).toBeTruthy();
    expect(screen.queryByText('no file selected')).toBeNull();
  });
});
