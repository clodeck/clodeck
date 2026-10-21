import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';

import { buildApp, type AppOptions } from './app.js';
import { createSessionStore } from './auth/sessions.js';
import { SESSION_COOKIE, type AuthOptions } from './auth/transport.js';
import { createProjectDiscovery } from './discovery.js';
import { createProviderProfiles } from './profiles.js';
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
 * serving the bundle (spec-06 §27). `trustedProxies: null` is the same kind of
 * default: the direct topology, which is what a suite gets unless it is about
 * life behind a proxy (ticket 65).
 *
 * `profiles` is deliberately the empty environment, which is every deployment
 * that declares none: the list is the reserved default alone, and a suite that
 * is about profiles says so by passing its own.
 */
export function createTestApp(overrides: Partial<AppOptions> = {}): FastifyInstance {
  return buildApp({
    projects: createProjectDiscovery(null, { warn: () => undefined }),
    provider: createFakeProvider(),
    profiles: createProviderProfiles({}, () => undefined),
    spawner: createFakePtySpawner(),
    auth: createTestAuth(),
    webRoot: null,
    trustedProxies: null,
    // This ticket's default: the suite that is about a deployment default says
    // so by overriding it, and every other suite runs in Ask.
    permissionMode: 'default',
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

/**
 * A response's `Set-Cookie` header as text, joined if the server sent several.
 * The cookie contract is asserted against these flags, so reading them off the
 * wire is the one piece of plumbing every cookie case in the server's suites
 * shares.
 */
export function setCookieHeader(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const setCookie = response.headers['set-cookie'];
  if (Array.isArray(setCookie)) return setCookie.join('\n');
  return typeof setCookie === 'string' ? setCookie : '';
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
