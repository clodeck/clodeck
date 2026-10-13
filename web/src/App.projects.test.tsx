// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

/**
 * Creating a project from the sidebar (ticket 47), driven through the real
 * shell — `App` → `useAuth` → `Shell` → `useProjects` → the switcher's dialog —
 * with only `fetch` stubbed. That is the whole of what this needs: a dialog, a
 * request and a re-render are exactly what jsdom *can* see, which is why the
 * ticket adds no sixth browser spec (the browser suite is for what jsdom
 * cannot: a download's chosen name, drag geometry, resolved colours).
 *
 * The filesystem effect is pinned on the server side, against real temp roots
 * (`discovery.test.ts`, `projects.test.ts`); what these tests are about is the
 * client's half: the button, the POST's body, the refusal that stays in the
 * dialog, and the reloaded list the new row is selected in.
 */

const alpha: Project = { id: 'AAA', name: 'alpha', path: '/projects/alpha' };

/** One request the shell made: how, where, and the `name` a create carried. */
interface Call {
  method: string;
  path: string;
  name: string | null;
}

/** The `name` of a JSON body, when there is one. */
function nameOf(init: RequestInit | undefined): string | null {
  if (typeof init?.body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(init.body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const name = (parsed as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function ok(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({ ok: true, status, statusText: 'OK', json: () => Promise.resolve(body) } as Response);
}

/** The server's error envelope, as the client's message mapping expects it. */
function failure(status: number, statusText: string, error: string): Response {
  return { ok: false, status, statusText, json: () => Promise.resolve({ error }) } as Response;
}

/**
 * The API behind a logged-in shell: `/auth/me` has a session, `/projects` lists
 * — and a create appends to that same list, as the server's re-scan would — or
 * answers the 409 an existing name gets. Every request is recorded.
 *
 * `startWith` is the root's contents, so a suite can open on the empty state.
 */
function stubApi(options: { startWith?: Project[]; conflict?: boolean } = {}): {
  calls: Call[];
  listing: Project[];
} {
  const { startWith = [alpha], conflict = false } = options;
  const calls: Call[] = [];
  const listing: Project[] = [...startWith];

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname, name: nameOf(init) });

    if (url.pathname === '/api/auth/me') {
      return ok({ principal: { id: 'default', name: 'default' } });
    }
    if (url.pathname !== '/api/projects') return Promise.resolve(failure(404, 'Not Found', 'not found'));
    if (method !== 'POST') return ok({ projects: listing });

    if (conflict) return Promise.resolve(failure(409, 'Conflict', 'already exists'));

    const name = nameOf(init) ?? '';
    const project: Project = { id: `id:${name}`, name, path: `/projects/${name}` };
    listing.push(project);
    return ok({ project }, 201);
  });

  return { calls, listing };
}

/** Sign in, wait for the list, and open the create dialog from the header. */
async function openDialog(): Promise<void> {
  await screen.findByRole('button', { name: 'alpha' });
  fireEvent.click(screen.getByRole('button', { name: 'New project' }));
  await screen.findByRole('dialog', { name: 'New project' });
}

function submit(name: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

/** The empty state's own button — the second of the two that carry that name. */
function emptyStateButton(): HTMLElement {
  const [, button] = screen.getAllByRole('button', { name: 'New project' });
  if (button === undefined) throw new Error('the empty state offers no New project button');
  return button;
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

describe('creating a project from the sidebar', () => {
  it('opens the dialog from the header button', async () => {
    stubApi();
    render(<App />);

    await openDialog();

    expect(screen.getByRole('dialog', { name: 'New project' })).toBeDefined();
  });

  it('offers it from the empty state too, which is no longer a dead end', async () => {
    stubApi({ startWith: [] });
    render(<App />);

    await screen.findByText(/No projects yet/);
    fireEvent.click(emptyStateButton());

    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeDefined();
  });

  it('posts the name, closes, reloads, selects the new row and says so', async () => {
    const { calls } = stubApi();
    render(<App />);

    await openDialog();
    submit('beta');

    // The create request itself: one POST, carrying the bare name.
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toEqual([
        { method: 'POST', path: '/api/projects', name: 'beta' },
      ]);
    });

    // The row the reloaded list brought: selected, in the app's own list.
    const row = await screen.findByRole('button', { name: 'beta' });
    await waitFor(() => {
      expect(row.getAttribute('aria-current')).toBe('true');
    });
    expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-current')).toBe('false');
    // The chat stage is on the new project, not the old one.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('beta');

    // The dialog is done, the list was re-fetched, and the toast said it.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.filter((call) => call.method === 'GET' && call.path === '/api/projects')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toContain('created beta');
  });

  it('keeps the dialog open with the server message when the name is taken', async () => {
    const { calls } = stubApi({ conflict: true });
    render(<App />);

    await openDialog();
    submit('alpha');

    // The refusal is the dialog's to show — and the list is left as it was.
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await waitFor(() => {
      expect(dialog.textContent).toContain('already exists');
    });
    expect(dialog.textContent).toContain('409');
    expect(screen.queryByRole('button', { name: 'beta' })).toBeNull();
    expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-current')).toBe('false');
    expect(calls.filter((call) => call.method === 'GET' && call.path === '/api/projects')).toHaveLength(1);
  });

  it('refuses a name the server would refuse — a leading dot included', async () => {
    const { calls } = stubApi();
    render(<App />);

    await openDialog();
    const create = screen.getByRole('button', { name: 'Create' });
    const name = screen.getByLabelText('Name');

    // The drawer's rule: one clean segment.
    expect(create.hasAttribute('disabled')).toBe(true);
    fireEvent.change(name, { target: { value: 'a/b' } });
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);

    // …and discovery's: a dot-directory is skipped by the scan, so such a
    // project could be created and then never seen. The client refuses it here
    // rather than letting the server explain it.
    fireEvent.change(name, { target: { value: '.hidden' } });
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(name, { target: { value: 'beta' } });
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(false);

    // Nothing invalid ever became a request.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });
});
