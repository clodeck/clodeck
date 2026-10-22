// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

/**
 * Deleting a project from the sidebar (ticket 90), driven through the real
 * shell — `App` → `useAuth` → `Shell` → `useProjects` → the switcher's row
 * menu and typed-name dialog — with only `fetch` stubbed.
 *
 * The filesystem effect is the server suite's (tickets 89's route and seam);
 * what these tests are about is the client's half: the row menu that opens
 * without selecting, the DELETE it sends, the reload and toast on a `204`, the
 * stage that empties rather than jumping to a neighbour, and the refusals that
 * keep the dialog open and keep the server's reason.
 */

const alpha: Project = { id: 'AAA', name: 'alpha', path: '/projects/alpha' };
const beta: Project = { id: 'BBB', name: 'beta', path: '/projects/beta' };

/** One request the shell made: how, and where. */
interface Call {
  method: string;
  path: string;
}

function ok(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response);
}

/** A delete that worked: `204` with no body, as the route sends it. */
function noContent(): Promise<Response> {
  return Promise.resolve({ ok: true, status: 204, statusText: 'No Content' } as Response);
}

/** The server's error envelope, as the client's message mapping expects it. */
function failure(status: number, statusText: string, error: string): Response {
  return { ok: false, status, statusText, json: () => Promise.resolve({ error }) } as Response;
}

/**
 * The API behind a logged-in shell. A DELETE removes the project from the same
 * listing a reload reads, exactly as the server's re-scan would; `refusal` makes
 * every delete answer the route's refusal instead, and touches nothing.
 */
function stubApi(
  options: {
    projects?: Project[];
    refusal?: { status: number; statusText: string; error: string };
  } = {},
): { calls: Call[]; listing: Project[] } {
  const { projects = [alpha, beta], refusal } = options;
  const calls: Call[] = [];
  const listing: Project[] = [...projects];

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname });

    if (url.pathname === '/api/auth/me') {
      return ok({ principal: { id: 'default', name: 'default' } });
    }
    if (url.pathname === '/api/projects') {
      // A copy, not the listing itself: the shell must see the deleted row go
      // on its reload, never by the stub mutating the array it already holds.
      return ok({ projects: [...listing] });
    }
    if (method === 'DELETE' && url.pathname.startsWith('/api/projects/')) {
      if (refusal !== undefined) {
        return Promise.resolve(failure(refusal.status, refusal.statusText, refusal.error));
      }
      const id = decodeURIComponent(url.pathname.slice('/api/projects/'.length));
      const index = listing.findIndex((project) => project.id === id);
      if (index !== -1) listing.splice(index, 1);
      return noContent();
    }

    return Promise.resolve(failure(404, 'Not Found', 'not found'));
  });

  return { calls, listing };
}

/** Wait for the sidebar's first list, then pick one project. */
async function select(name: string): Promise<void> {
  await screen.findByRole('button', { name: 'alpha' });
  fireEvent.click(screen.getByRole('button', { name }));
}

/** Open one row's `⋯` menu and choose its one item. */
function chooseDelete(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
}

/** Type the exact name and press the dialog's Delete. */
function confirmDelete(name: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

describe('deleting a project from the sidebar', () => {
  it('sends the DELETE, reloads the list and says deleted <name>', async () => {
    const { calls, listing } = stubApi();
    render(<App />);

    await select('beta');
    chooseDelete('alpha');

    // The typed-name dialog names the project and shows the canonical path.
    const dialog = await screen.findByRole('dialog', { name: 'Delete project' });
    expect(dialog.textContent).toContain('alpha');
    expect(dialog.textContent).toContain(alpha.path);
    expect(dialog.textContent).toContain('This cannot be undone.');

    confirmDelete('alpha');

    // One DELETE, at the id it was asked about.
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { method: 'DELETE', path: `/api/projects/${alpha.id}` },
      ]);
    });

    // The reloaded list no longer carries it, and the create-style toast says so.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'alpha' })).toBeNull();
      expect(screen.getByRole('button', { name: 'beta' })).toBeDefined();
    });
    expect(listing.map((project) => project.name)).toEqual(['beta']);
    expect(calls.filter((call) => call.method === 'GET' && call.path === '/api/projects')).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('deleted alpha')).toBeTruthy();

    // The project that was selected is still the one on the stage.
    expect(screen.getByRole('button', { name: 'beta' }).getAttribute('aria-current')).toBe('true');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('beta');
  });

  it('empties the stage when the deleted project was the selected one — never a neighbour', async () => {
    const { listing } = stubApi();
    render(<App />);

    await select('alpha');
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    chooseDelete('alpha');
    confirmDelete('alpha');

    // The existing no-project empty state, not the next row.
    await screen.findByText('Select a project to begin.');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'alpha' })).toBeNull();
      expect(screen.getByRole('button', { name: 'beta' })).toBeDefined();
    });
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(listing.map((project) => project.name)).toEqual(['beta']);
    // beta is still there, and still not chosen.
    expect(screen.getByRole('button', { name: 'beta' }).getAttribute('aria-current')).toBe('false');
  });

  it('keeps the dialog open with a sentence for every refusal, and loses nothing', async () => {
    const refusals = [
      {
        status: 409,
        statusText: 'Conflict',
        error: 'turn_in_progress',
        sentence: 'A turn is running in this project. Wait for it to finish, then try again.',
      },
      {
        status: 409,
        statusText: 'Conflict',
        error: 'terminal_attached',
        sentence: 'A terminal is attached to this project. Close it, then try again.',
      },
      {
        status: 400,
        statusText: 'Bad Request',
        error: 'symlink',
        sentence: 'This project is reached through a symlink or an ambiguous entry, so it cannot be deleted.',
      },
    ];

    for (const refusal of refusals) {
      cleanup();
      const { calls } = stubApi({ refusal });
      render(<App />);

      await select('alpha');
      chooseDelete('alpha');
      confirmDelete('alpha');

      // Still open, with the refusal as a sentence in it.
      const dialog = await screen.findByRole('dialog', { name: 'Delete project' });
      await waitFor(() => {
        expect(dialog.textContent).toContain(refusal.sentence);
      });

      // The list and the selection did not move, and no re-list happened.
      expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-current')).toBe('true');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('alpha');
      expect(calls.filter((call) => call.method === 'GET' && call.path === '/api/projects')).toHaveLength(1);
      expect(screen.queryByText('deleted alpha')).toBeNull();
    }
  });

  it('cancels without a request and without removing anything', async () => {
    const { calls, listing } = stubApi();
    render(<App />);

    await select('beta');
    chooseDelete('alpha');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(listing.map((project) => project.name)).toEqual(['alpha', 'beta']);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy();
    // Cancelling is not selecting either.
    expect(screen.getByRole('button', { name: 'alpha' }).getAttribute('aria-current')).toBe('false');
  });
});
