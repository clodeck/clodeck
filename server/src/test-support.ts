import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { createSessionStore } from './auth/sessions.js';
import { SESSION_COOKIE, type AuthOptions } from './auth/transport.js';

/**
 * The fixture the server's suites share: a throwaway sandbox with a `projects`
 * root inside it. The sandbox is `realpath`'d first, so its own symlinks
 * (macOS `/var` → `/private/var`, Windows 8.3 names) cannot make expectations
 * lie.
 *
 * Test support, not package code — `tsconfig.build.json` keeps it out of `dist`.
 */

/** Junctions need no elevation on Windows; real directory symlinks elsewhere. */
export const linkType = process.platform === 'win32' ? 'junction' : 'dir';

/** The password every suite but `password.test.ts` logs in with. */
export const TEST_PASSWORD = 'test-password';

/**
 * The `auth` seam for a suite: a trivial verifier — scrypt is deliberately
 * slow, and only `password.test.ts` should pay for it (spec-05 §Testing) — over
 * a real in-memory session store, so a logged-in cookie is a real session.
 */
export function createTestAuth(overrides: Partial<AuthOptions> = {}): AuthOptions {
  return {
    verifyPassword: (password) => Promise.resolve(password === TEST_PASSWORD),
    sessions: createSessionStore(),
    warn: () => undefined,
    ...overrides,
  };
}

/**
 * Log in for real and hand back the `cookie` header the next request or socket
 * handshake must carry. The gate is always installed and has no bypass, so
 * authenticating through the same door a browser uses is what keeps each suite
 * asserting *its* slice instead of re-testing auth.
 */
export async function login(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: TEST_PASSWORD },
  });

  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${String(response.statusCode)} ${response.body}`);
  }

  const setCookie = response.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  // `clodeck_session=<token>; Path=/; HttpOnly; …` — the client sends the first segment back.
  const cookie = header?.split(';')[0];
  if (cookie === undefined || !cookie.startsWith(`${SESSION_COOKIE}=`)) {
    throw new Error('login set no session cookie');
  }

  return cookie;
}

export interface Sandbox {
  /** The realpath'd temp directory. Fixtures that must stay *outside* the root live here. */
  dir: string;
  /** The projects root, created inside `dir`. */
  root: string;
}

export async function createSandbox(prefix = 'clodeck-test-'): Promise<Sandbox> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  const root = path.join(dir, 'projects');
  await mkdir(root);

  return { dir, root };
}

export async function removeSandbox(sandbox: Sandbox): Promise<void> {
  await rm(sandbox.dir, { recursive: true, force: true });
}
