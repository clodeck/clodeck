// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../toast/ToastProvider';
import { FilePanel } from './FilePanel';

/**
 * The file panel's two contracts, over the real `useFiles` seam.
 *
 * **Layout:** the tree column and the code column are siblings of one row, and
 * the open file lands in the code column — not under the tree, as the
 * pre-drawer stack had it. jsdom computes no layout, so "side by side" cannot be
 * measured; what is asserted instead is the structure that carries it — two
 * direct children of one row-flex section, the first of them the fixed-width
 * tree.
 *
 * **Speech:** a mutation that worked says so through the app's one toast surface,
 * and a mutation that failed says nothing there — it keeps the error surface it
 * already had (the name prompt's inline message). The panel is rendered inside a
 * real `ToastProvider`, because that is where it lives in the app.
 */

const project: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };

const FILE_BODY = 'const answer = 42;';

/**
 * One file endpoint: a root listing (a folder and a file), the file's content,
 * and mutations that succeed — or fail, when `failMutations` says so.
 */
function stubFiles(failMutations = false): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input), 'http://localhost');
    if ((init?.method ?? 'GET') !== 'GET') {
      return Promise.resolve(
        failMutations
          ? {
              ok: false,
              status: 500,
              statusText: 'Internal Server Error',
              json: () => Promise.resolve({ error: 'disk is full' }),
            }
          : { ok: true, status: 200, json: () => Promise.resolve({}) },
      );
    }
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

/** The panel where it lives, returning the toast surface it speaks through. */
function renderPanel(): { container: HTMLElement; notifications: HTMLElement } {
  const { container } = render(
    <ToastProvider>
      <FilePanel project={project} />
    </ToastProvider>,
  );
  return { container, notifications: screen.getByRole('status') };
}

/** Fill the name prompt and commit it. */
function create(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'New File' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

/** One of the panel's two columns, by position. */
function column(panel: Element, index: number): HTMLElement {
  const child = panel.children[index];
  if (child === undefined) throw new Error(`the Files panel has no column ${String(index)}`);
  return child as HTMLElement;
}

describe('FilePanel in the drawer', () => {
  it('is a 300px tree column beside a code column, and opens a file into the code column', async () => {
    stubFiles();
    const { container } = renderPanel();

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

describe('the file panel says what it did', () => {
  it('names the new file and the folder it landed in', async () => {
    stubFiles();
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    // Making a folder active is what the message has to report, so the create
    // does not land at the root: expand `src` (a click both expands and picks).
    fireEvent.click(screen.getByTitle('Expand folder'));
    create('notes.md');

    await waitFor(() => {
      expect(notifications.textContent).toBe('file notes.md created in src');
    });
  });

  it('says a renamed entry by its new name, and a deleted one by its old one', async () => {
    stubFiles();
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for README.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'GUIDE.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => {
      expect(notifications.textContent).toBe('renamed to GUIDE.md');
    });

    // A delete confirms first, then reports — twice, in that order.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for README.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm delete' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(notifications.textContent).toBe('deleted README.md');
    });
  });

  it('reports a single uploaded file, and stays quiet on a failure', async () => {
    stubFiles();
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    const picked = new File(['# hello'], 'notes.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [picked] } });
    await waitFor(() => {
      expect(notifications.textContent).toBe('uploaded notes.md');
    });
  });

  it('leaves the surface empty when a mutation fails, and the error where it was', async () => {
    stubFiles(true);
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    create('notes.md');

    // The name prompt keeps the server's message — unchanged by this ticket —
    // and the success surface never speaks.
    expect(await screen.findByText('500 Internal Server Error: disk is full')).toBeTruthy();
    expect(notifications.textContent).toBe('');
  });
});
