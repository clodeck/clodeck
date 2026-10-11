import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';

import { buildApp, type AppOptions } from './app.js';
import { createSessionStore } from './auth/sessions.js';
import { SESSION_COOKIE, type AuthOptions } from './auth/transport.js';
import { createProjectDiscovery } from './discovery.js';
import { createFakePtySpawner } from './testing/fake-pty.js';
import { createFakeProvider } from './testing/fake-provider.js';

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
 * The app a suite starts from: the scripted SDK and pty, the real gate over a
 * real session store, and no client bundle. A suite names only the options it
 * is *about* — everything else is one decision, made here, rather than the same
 * five lines in seven files.
 *
 * `webRoot: null` is the shared one: no suite but `static.test.ts` is about
 * serving the bundle (spec-06 §27).
 */
export function createTestApp(overrides: Partial<AppOptions> = {}): FastifyInstance {
  return buildApp({
    projects: createProjectDiscovery(null, { warn: () => undefined }),
    provider: createFakeProvider(),
    spawner: createFakePtySpawner(),
    auth: createTestAuth(),
    webRoot: null,
    ...overrides,
  });
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

/**
 * Boot the app on a real port and hand back the number. `inject()` covers the
 * REST surface; a WebSocket handshake cannot be injected, so the socket suites
 * listen for real — on port 0, so two suites never collide.
 */
export async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server did not bind a port');
  }
  return address.port;
}

export interface Handshake {
  /** The upgrade was accepted. */
  ok: boolean;
  /** What refused it, when it was refused — `Unexpected server response: 401`. */
  error: string;
  /** The first frame on the socket: the bus's opening snapshot. */
  first: Promise<string>;
}

/**
 * What a client sees: `open`, or the error that refused the upgrade. The socket
 * is left open — `app.close()` in the suite's `afterEach` tears it down, and
 * closing here would race the first frame the caller is waiting for.
 */
export function handshake(url: string, headers: Record<string, string> = {}): Promise<Handshake> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    let first: Promise<string> = Promise.resolve('');
    socket.on('open', () => {
      first = new Promise<string>((read) => socket.once('message', (data) => read(data.toString())));
      resolve({ ok: true, error: '', first });
    });
    socket.on('error', (error: Error) => {
      resolve({ ok: false, error: error.message, first });
    });
  });
}
