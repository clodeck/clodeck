// @vitest-environment jsdom
import { MAX_UPLOAD_BYTES, type Project } from '@clodeck/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** Markdown, with the constructs the preview has to render. */
const MD_BODY = '# Guide\n\nRead **this**, not that.';

/** A listing row's size, independent of the content body so the two cannot be confused. */
const README_SIZE = 1536;

/** An mtime three hours old, so a row's relative label is a fixed `3h ago`. */
function threeHoursAgo(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
}

/** One request the panel made: how, to which relative path, and a `to` if it carried one. */
interface Call {
  method: string;
  path: string;
  /** The `to` of a JSON body — a rename's new name, or a move's destination folder. */
  to?: string;
}

/** A request body's `to`, when the body is JSON that carries one. */
function toOf(init: RequestInit | undefined): string | undefined {
  if (typeof init?.body !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(init.body);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const to = (parsed as { to?: unknown }).to;
    return typeof to === 'string' ? to : undefined;
  } catch {
    // A save sends raw content in the same shape of request; it has no `to`.
    return undefined;
  }
}

/** The server's error envelope, as the transport's mapping expects it. */
function failure(status: number, statusText: string, error: string): Response {
  return { ok: false, status, statusText, json: () => Promise.resolve({ error }) } as Response;
}

/**
 * One file endpoint: a root listing (a folder and a file), the file's content,
 * and mutations that succeed — or fail, when `failMutations` says so, or when the
 * path is one of `failUploads` (a 409 on that file alone, so a batch's other
 * files still land). Every request is recorded, which is how "no request was
 * made" and "the listing re-listed once" are asserted.
 */
function stubFiles(options: { failMutations?: boolean; failUploads?: string[]; truncated?: boolean } = {}): {
  calls: Call[];
  mtime: string;
} {
  const { failMutations = false, failUploads = [], truncated = false } = options;
  const calls: Call[] = [];
  const mtime = threeHoursAgo();

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const path = url.searchParams.get('path') ?? '';
    calls.push({ method, path, to: toOf(init) });

    if (method !== 'GET') {
      if (failMutations) return Promise.resolve(failure(500, 'Internal Server Error', 'disk is full'));
      if (failUploads.includes(path)) return Promise.resolve(failure(409, 'Conflict', 'already exists'));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }

    const content = path.endsWith('GUIDE.md') ? MD_BODY : FILE_BODY;
    const body = url.pathname.endsWith('/files/content')
      ? { content: { kind: 'text', content, truncated, size: content.length } }
      : {
          entries: [
            { type: 'directory', name: 'src' },
            { type: 'file', name: 'README.md', size: README_SIZE, mtime },
            { type: 'file', name: 'GUIDE.md', size: README_SIZE, mtime },
            { type: 'file', name: 'main.ts', size: README_SIZE, mtime },
          ],
        };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });

  return { calls, mtime };
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

/** The panel where it lives, returning the toast surface it speaks through. */
function renderPanel(): { container: HTMLElement; panel: HTMLElement; notifications: HTMLElement } {
  const { container } = render(
    <ToastProvider>
      <FilePanel project={project} />
    </ToastProvider>,
  );
  const panel = container.querySelector<HTMLElement>('section[aria-label="Files"]');
  if (panel === null) throw new Error('no Files panel');
  return { container, panel, notifications: screen.getByRole('status') };
}

/** A drag carrying OS files — the shape the panel reacts to. */
function osDrag(files: File[]): { dataTransfer: { types: string[]; files: File[] } } {
  return { dataTransfer: { types: ['Files'], files } };
}

/**
 * The drag a move is made of: pick a file row up and drop it on a folder row (or
 * on the breadcrumb's root crumb). The transfer the browser hands a drag is
 * stubbed the way the panel uses it — `setData` for the path it carries, and a
 * writable `effectAllowed`.
 */
function moveRowOnto(row: HTMLElement, target: HTMLElement): void {
  fireEvent.dragStart(row, { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
  fireEvent.dragOver(target, {});
  fireEvent.drop(target, {});
}

/**
 * A drag leaving `row` for whatever is under the pointer now. jsdom has no
 * `DragEvent`, and `fireEvent.dragLeave` loses `relatedTarget` before React's
 * synthetic event sees it — so the one case that needs it (a drag moving between
 * a row and the row's own children) is dispatched as a bubbling `MouseEvent` of
 * the same type, which React handles as the drag event it is.
 */
function dragLeaves(row: HTMLElement, related: EventTarget | null): void {
  // In `act` because the raw `dispatchEvent` skips what `fireEvent` does around
  // it, and clearing the highlight is a state change like any other.
  act(() => {
    row.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: related }));
  });
}

/** A file that reports itself over the cap, without allocating 200 MiB to say so. */
function oversize(name: string): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 });
  return file;
}

/** Fill the name prompt and commit it. */
function create(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'New File' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

/** The row element a name button belongs to (the tree row and the flat row are both one). */
function rowOf(button: HTMLElement): HTMLElement {
  const row = button.parentElement;
  if (row === null) throw new Error('a row button has no row');
  return row;
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

  it('reports a single uploaded file', async () => {
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
    stubFiles({ failMutations: true });
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    create('notes.md');

    // The name prompt keeps the server's message — unchanged by this ticket —
    // and the success surface never speaks.
    expect(await screen.findByText('500 Internal Server Error: disk is full')).toBeTruthy();
    expect(notifications.textContent).toBe('');
  });
});

describe('dropping files on the drawer', () => {
  it('shows where they will land and the cap they have to be under, and clears on leave', async () => {
    stubFiles();
    const { panel } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    expect(screen.queryByText('Drop files to upload · max 200 MB')).toBeNull();

    fireEvent.dragOver(panel, osDrag([]));
    expect(screen.getByText('Drop files to upload · max 200 MB')).toBeTruthy();

    fireEvent.dragLeave(panel, { relatedTarget: null });
    expect(screen.queryByText('Drop files to upload · max 200 MB')).toBeNull();
  });

  it('ignores a drag that is not carrying OS files', async () => {
    stubFiles();
    const { panel } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    // A tree row dragged for a move (ticket 44) carries text/plain, not Files.
    fireEvent.dragOver(panel, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByText('Drop files to upload · max 200 MB')).toBeNull();
  });
});

describe('a batch upload reports itself once', () => {
  it('sends every dropped file and settles into one message, re-listing once', async () => {
    const { calls } = stubFiles();
    const { panel, notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });
    const listings = calls.filter((call) => call.method === 'GET').length;

    const files = [new File(['a'], 'one.txt'), new File(['b'], 'two.txt')];
    fireEvent.dragOver(panel, osDrag(files));
    fireEvent.drop(panel, osDrag(files));

    await waitFor(() => {
      expect(notifications.textContent).toBe('2 uploaded');
    });
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.path)).toEqual([
      'one.txt',
      'two.txt',
    ]);
    // The overlay is gone, and the whole batch cost exactly one re-listing.
    expect(screen.queryByText('Drop files to upload · max 200 MB')).toBeNull();
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'GET')).toHaveLength(listings + 1);
    });
  });

  it('counts a mixed batch, keeps the first reason, and still re-lists', async () => {
    const { calls } = stubFiles({ failUploads: ['dup.txt'] });
    const { panel, notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });
    const listings = calls.filter((call) => call.method === 'GET').length;

    const files = [new File(['a'], 'one.txt'), new File(['b'], 'dup.txt'), new File(['c'], 'two.txt')];
    fireEvent.drop(panel, osDrag(files));

    await waitFor(() => {
      expect(within(notifications).getByText('2 uploaded · 1 failed')).toBeTruthy();
    });
    // The reason rides with the counts instead of being swallowed by them.
    expect(within(notifications).getByText('409 Conflict: already exists')).toBeTruthy();
    // One bad file did not abort the batch: all three were sent.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(3);
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'GET')).toHaveLength(listings + 1);
    });
  });

  it('refuses an oversize file in the client, with no request at all', async () => {
    const { calls } = stubFiles();
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    fireEvent.change(screen.getByLabelText('Choose files to upload'), {
      target: { files: [oversize('big.bin')] },
    });

    await waitFor(() => {
      expect(within(notifications).getByText('1 failed')).toBeTruthy();
    });
    expect(within(notifications).getByText('over the 200 MB upload limit')).toBeTruthy();
    // The server's 413 is the backstop, not the way this is found out.
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
  });

  it('counts a refused file with the rest of the batch rather than on its own', async () => {
    const { calls } = stubFiles();
    const { panel, notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    const files = [new File(['a'], 'one.txt'), oversize('big.bin')];
    fireEvent.drop(panel, osDrag(files));

    // One summary, not a message per file: the oversize one is a failure in it.
    await waitFor(() => {
      expect(within(notifications).getByText('1 uploaded · 1 failed')).toBeTruthy();
    });
    expect(within(notifications).getByText('over the 200 MB upload limit')).toBeTruthy();
    // The file that fits still went.
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.path)).toEqual(['one.txt']);
  });
});

describe('a markdown file can be read as markdown', () => {
  it('offers the toggle on a markdown file only, and opens each file as source', async () => {
    stubFiles();
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'GUIDE.md' }));
    // Source first, as the prototype opens one: the label names where a click goes.
    const toggle = await screen.findByRole('button', { name: 'Preview' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Source' })).toBeTruthy();

    // A file that is not markdown has no preview mode at all...
    fireEvent.click(screen.getByRole('button', { name: 'main.ts' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
    });

    // ...and opening a markdown file again starts from its source.
    fireEvent.click(screen.getByRole('button', { name: 'GUIDE.md' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('renders the markdown the server sent, and switches back to the source', async () => {
    stubFiles();
    const { panel } = renderPanel();
    const code = column(panel, 1);

    fireEvent.click(await screen.findByRole('button', { name: 'GUIDE.md' }));
    await waitFor(() => {
      expect(code.querySelector('pre')?.textContent).toBe(MD_BODY);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Guide' })).toBeTruthy();
    expect(within(code).getByText('this')).toBeTruthy();
    // The same bytes, read two ways — and the control says which way is next.
    const toggle = screen.getByRole('button', { name: 'Source' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    expect(code.querySelector('pre')?.textContent).toBe(MD_BODY);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('previews what the server sent — the truncation note included, and no second read', async () => {
    const { calls } = stubFiles({ truncated: true });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'GUIDE.md' }));
    await screen.findByText('truncated');
    const reads = calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Guide' })).toBeTruthy();

    // The preview is the truncated window the read returned, said so in the
    // head: rendering it is not a reason to ask the server for the whole file.
    expect(screen.getByText('truncated')).toBeTruthy();
    expect(calls).toHaveLength(reads);
  });
});

describe('downloading the open file', () => {
  it('offers the selected entry as a link to its own bytes, and says it was handed over', async () => {
    stubFiles();
    const { notifications } = renderPanel();

    // Nothing selected yet, so there is nothing to download.
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText(FILE_BODY);

    // A real link to the route, under the file's own name — the browser saves
    // the bytes, not the panel's copy of them.
    const link = screen.getByRole('link', { name: 'Download' });
    expect(link.getAttribute('href')).toBe('/api/projects/AAA/files/download?path=README.md');
    expect(link.getAttribute('download')).toBe('README.md');

    fireEvent.click(link);
    await waitFor(() => {
      expect(notifications.textContent).toBe('downloaded README.md');
    });
  });
});

describe('the tree and the flat list are two views of one folder', () => {
  it('flips to a flat list that shows the columns, and back to the tree', async () => {
    stubFiles();
    const { panel } = renderPanel();
    const tree = column(panel, 0);
    const code = column(panel, 1);

    fireEvent.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText(FILE_BODY);

    // The tree: folders expand in place, and no list head anywhere.
    expect(screen.getByTitle('Expand folder')).toBeTruthy();
    expect(screen.queryByText('Size')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    // One folder's entries under a head that names the three columns.
    expect(within(tree).getByText('Name')).toBeTruthy();
    expect(within(tree).getByText('Size')).toBeTruthy();
    expect(within(tree).getByText('Modified')).toBeTruthy();

    const dirRow = screen.getByRole('button', { name: 'src/' });
    const fileRow = screen.getByRole('button', { name: 'README.md' });
    // Directories first, as the tree sorts them.
    expect(dirRow.compareDocumentPosition(fileRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const fileCells = rowOf(fileRow);
    expect(within(fileCells).getByText('1.5 KB')).toBeTruthy();
    expect(within(fileCells).getByText('3h ago')).toBeTruthy();
    // A folder has neither on the wire, so its row is its name and its menu.
    expect(rowOf(dirRow).textContent).toBe('src/⋯');

    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));

    // Back to the tree, with the open file still where it was.
    expect(screen.getByTitle('Expand folder')).toBeTruthy();
    expect(screen.queryByText('Size')).toBeNull();
    expect(code.contains(screen.getByText(FILE_BODY))).toBe(true);
  });

  it('opens a folder in the list, keeps the scope visible, and creates in it', async () => {
    stubFiles();
    const { notifications } = renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'src/' }));

    // The breadcrumb names the folder being listed: the root, then the one we opened.
    const crumbs = await screen.findByRole('navigation', { name: 'Folder' });
    expect(within(crumbs).getByRole('button', { name: 'root' })).toBeTruthy();
    expect(within(crumbs).getByText('src').getAttribute('aria-current')).toBe('true');

    // New file and upload target the folder being shown, not the root.
    create('notes.md');
    await waitFor(() => {
      expect(notifications.textContent).toBe('file notes.md created in src');
    });

    // Up through the breadcrumb — and the folder we opened stays open, because
    // entering it is not the same click as expanding it.
    fireEvent.click(within(crumbs).getByRole('button', { name: 'root' }));
    expect(within(crumbs).getByText('root').getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getByTitle('Collapse folder')).toBeTruthy();
  });

  it('addresses a flat row by the folder being listed', async () => {
    const { calls } = stubFiles();
    renderPanel();
    await screen.findByRole('button', { name: 'README.md' });

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    fireEvent.click(screen.getByRole('button', { name: 'src/' }));

    // The row menu is the same one the tree rows carry, over a path joined to
    // the folder on screen rather than to the root.
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for README.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'GUIDE.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['src/README.md']);
    });
  });
});

describe('file rows carry their metadata', () => {
  it('shows a size and, in the tooltip, when it changed — and nothing for a folder', async () => {
    const { mtime } = stubFiles();
    renderPanel();

    const readme = await screen.findByRole('button', { name: 'README.md' });
    const fileRow = readme.parentElement;
    const dirRow = screen.getByTitle('Expand folder').parentElement;
    if (fileRow === null || dirRow === null) throw new Error('a row has no element');

    expect(within(fileRow).getByText('1.5 KB')).toBeTruthy();
    // The row's tooltip: the relative form over the server's exact timestamp.
    expect(fileRow.getAttribute('title')).toBe(`modified 3h ago · ${mtime}`);

    // A directory has no size or mtime on the wire, so its row is its name and
    // its menu, with nothing measured invented in between.
    expect(dirRow.textContent).toBe('▸ src/⋯');
    expect(dirRow.getAttribute('title')).toBeNull();
  });
});

describe('dragging a file onto a folder', () => {
  it('highlights the folder under the drag, and clears it when the drag leaves', async () => {
    stubFiles();
    const { panel } = renderPanel();
    const readme = await screen.findByRole('button', { name: 'README.md' });
    const folder = screen.getByTitle('Expand folder');
    if (folder.parentElement === null) throw new Error('the folder row has no element');
    const dirRow = folder.parentElement;

    fireEvent.dragStart(rowOf(readme), { dataTransfer: { setData: () => undefined, effectAllowed: '' } });
    // The target's own outline is the whole of the feedback.
    expect(dirRow.className).not.toContain('outline-accent');

    fireEvent.dragOver(dirRow, {});
    expect(dirRow.className).toContain('outline-accent');

    // Leaving it — and moving between the row's own children is not leaving it.
    dragLeaves(dirRow, folder);
    expect(dirRow.className).toContain('outline-accent');
    dragLeaves(dirRow, null);
    expect(dirRow.className).not.toContain('outline-accent');
    expect(panel.contains(dirRow)).toBe(true);
  });

  it('confirms first, then moves the file and says where it went', async () => {
    const { calls } = stubFiles();
    const { notifications } = renderPanel();
    const readme = await screen.findByRole('button', { name: 'README.md' });
    const folder = screen.getByTitle('Expand folder');

    moveRowOnto(rowOf(readme), folder.parentElement as HTMLElement);

    // The prototype's question, with the folder it would land in.
    const dialog = await screen.findByRole('dialog', { name: 'Confirm move' });
    expect(within(dialog).getByText('Move "README.md" into "src"?')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      expect(notifications.textContent).toBe('moved README.md → src');
    });
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: 'README.md', to: 'src' },
    ]);
    // The destination is left open — dropping into a folder is meant to show the
    // arrival — so its listing was fetched again.
    await waitFor(() => {
      expect(calls.filter((call) => call.path === 'src')).not.toHaveLength(0);
    });
  });

  it('follows an open file to its new path, so the column is not left stale', async () => {
    const { calls } = stubFiles();
    const { panel } = renderPanel();
    const code = column(panel, 1);

    fireEvent.click(await screen.findByRole('button', { name: 'README.md' }));
    await screen.findByText(FILE_BODY);
    expect(within(code).getByText('README.md')).toBeTruthy();

    moveRowOnto(rowOf(screen.getByRole('button', { name: 'README.md' })), screen.getByTitle('Expand folder').parentElement as HTMLElement);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Confirm move' })).getByRole('button', { name: 'Move' }));

    // The same bytes, under the path they now live at.
    await waitFor(() => {
      expect(within(code).getByText('src/README.md')).toBeTruthy();
    });
    expect(calls.filter((call) => call.path === 'src/README.md').map((call) => call.method)).toEqual(['GET']);
  });

  it('cancels without a request, a toast, or a row left highlighted', async () => {
    const { calls } = stubFiles();
    const { notifications } = renderPanel();
    const readme = await screen.findByRole('button', { name: 'README.md' });
    const folder = screen.getByTitle('Expand folder');

    moveRowOnto(rowOf(readme), folder.parentElement as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm move' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Confirm move' })).toBeNull();
    expect(notifications.textContent).toBe('');
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    // The row the file was dragged from is still there, and nothing is outlined.
    expect(screen.getByRole('button', { name: 'README.md' })).toBeTruthy();
    expect((folder.parentElement as HTMLElement).className).not.toContain('outline-accent');
  });

  it('refuses a move into the folder the file already lives in, without asking the server', async () => {
    const { calls } = stubFiles();
    const { notifications } = renderPanel();
    const readme = await screen.findByRole('button', { name: 'README.md' });
    const crumbs = screen.getByRole('navigation', { name: 'Folder' });

    // The root crumb is the one drop target a file dragged out of a subfolder
    // has to get home to — and it is also where `README.md` already is.
    moveRowOnto(rowOf(readme), within(crumbs).getByText('root'));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm move' });
    expect(within(dialog).getByText('Move "README.md" into "root"?')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      expect(notifications.textContent).toBe('already in root');
    });
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('keeps the server’s refusal in the dialog and changes nothing', async () => {
    const { calls } = stubFiles({ failMutations: true });
    const { notifications } = renderPanel();
    const readme = await screen.findByRole('button', { name: 'README.md' });

    moveRowOnto(rowOf(readme), screen.getByTitle('Expand folder').parentElement as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm move' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    expect(await screen.findByText('500 Internal Server Error: disk is full')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Confirm move' })).toBeTruthy();
    expect(notifications.textContent).toBe('');
    // One attempt, and nothing else: a failed move re-lists nothing.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: 'README.md', to: 'src' },
    ]);
  });
});

