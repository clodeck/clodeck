// @vitest-environment jsdom
import type { BuildStamp, Project } from '@clodeck/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

/**
 * The build stamp on the screen a signed-in user actually lands on (ticket 94):
 * `App` → `useAuth` → `useBuildStamp` → the sidebar header. Only `fetch` is
 * stubbed, so this is the wiring the login-screen suite cannot see — the hook
 * sits above the auth gate, and this proves its answer reaches the header.
 *
 * The three display states (a commit, `-dirty`, and `dev`/`unknown`) are pinned
 * on `LoginScreen`, which draws the same component; this file is about the
 * line being there at all, with the full SHA still in `title`.
 */

const SHA = 'fcbd770000000000000000000000000000000000';
const BUILT_AT = new Date(2026, 9, 23, 14, 5).toISOString();
const BUILD: BuildStamp = { commit: SHA, builtAt: BUILT_AT, dirty: false };

const alpha: Project = { id: 'AAA', name: 'alpha', path: '/projects/alpha' };

function ok(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) } as Response);
}

function stubApi(): ReturnType<typeof vi.fn> {
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/auth/me') return ok({ principal: { id: 'default', name: 'default' } });
    if (url.pathname === '/api/projects') return ok({ projects: [alpha] });
    if (url.pathname === '/healthz') return ok({ status: 'ok', build: BUILD });
    return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', json: () => Promise.resolve({ error: 'not found' }) } as Response);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

describe('the build stamp in the sidebar', () => {
  it('draws the running build under “remote Claude Code”, with the full SHA in title', async () => {
    stubApi();
    render(<App />);

    // The header exists only once the shell is mounted, so this also proves the
    // stamp is read above the auth boundary rather than by the chat panels.
    const line = await screen.findByTitle(SHA);

    expect(line.textContent).toBe('fcbd770 · 2026-10-23 14:05');
    expect(screen.getByText('remote Claude Code')).toBeTruthy();
  });
});
