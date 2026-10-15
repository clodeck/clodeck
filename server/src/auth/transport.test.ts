import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { setCookieHeader } from '../test-support.js';
import { createSessionStore } from './sessions.js';
import {
  createAuthGate,
  installWebSocketGuards,
  registerAuthMeRoute,
  registerAuthRoutes,
  SESSION_COOKIE,
  type AuthOptions,
} from './transport.js';

/**
 * The auth transport, asserted at the wire: status codes, the cookie's flag
 * matrix, and a real WebSocket handshake refused before it becomes a socket.
 *
 * The app here is assembled the way `buildApp` assembles it — exempt routes on
 * a bare `/api` scope, everything else in a nested *gated* scope, and both
 * WebSocket guards on the socket's own scope — because that structure is the
 * security boundary, not an implementation detail of the wiring.
 */
describe('the auth transport', () => {
  const TEST_PASSWORD = 'test-password';
  const OTHER_ADDRESS = '10.9.8.7';

  let apps: FastifyInstance[];

  beforeEach(() => {
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  function makeApp(overrides: Partial<AuthOptions> = {}): FastifyInstance {
    const options: AuthOptions = {
      verifyPassword: (password) => Promise.resolve(password === TEST_PASSWORD),
      sessions: createSessionStore(),
      warn: () => undefined,
      ...overrides,
    };

    const app = Fastify({ logger: false });
    app.register(cookie);
    app.register(websocket);

    app.register(
      async (api) => {
        registerAuthRoutes(api, options);
        api.register(async (gated) => {
          gated.addHook('onRequest', createAuthGate(options.sessions));
          gated.get('/projects', async () => ({ projects: [] }));
          registerAuthMeRoute(gated);
        });
      },
      { prefix: '/api' },
    );

    app.register(async (bus) => {
      installWebSocketGuards(bus, options);
      bus.get('/ws', { websocket: true }, (socket) => {
        socket.send('connected');
        socket.close();
      });
    });

    apps.push(app);
    return app;
  }

  /** Log in for real and hand back the `cookie` header a client would send next. */
  async function login(app: FastifyInstance, password = TEST_PASSWORD): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password },
    });
    expect(response.statusCode).toBe(200);

    const header = cookieHeaderOf(response.headers['set-cookie']);
    expect(header).not.toBeNull();
    return header ?? '';
  }

  function cookieHeaderOf(setCookie: string | string[] | undefined): string | null {
    const values = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
    const session = values.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
    return session === undefined ? null : (session.split(';')[0] ?? null);
  }

  it('refuses a gated route with no cookie', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/api/projects' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'authentication required' });
    // No session was named, so this is not merely a stale one.
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses /api/auth/me with a cookie that names no session', async () => {
    const response = await makeApp().inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=forged-token` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('issues a session cookie on login and serves the fixed principal behind it', async () => {
    const app = makeApp();
    const cookie = await login(app);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const projects = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ principal: { id: 'default', name: 'default' } });
    expect(projects.statusCode).toBe(200);
    expect(projects.json()).toEqual({ projects: [] });
  });

  it('sets the cookie HttpOnly, Secure, SameSite=Strict, scoped to / for the idle window', async () => {
    const response = await makeApp().inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    const value = setCookieHeader(response);
    // Page JS cannot read it, it only travels over HTTPS, and it never rides a
    // cross-site request — the three properties the slice is built on.
    expect(value).toContain('HttpOnly');
    expect(value).toContain('Secure');
    expect(value).toContain('SameSite=Strict');
    expect(value).toContain('Path=/');
    expect(value).toContain('Max-Age=604800');
    // The value is the store's token, not a claim: no signing, no `=` inside it.
    expect(value).not.toContain('Signature=');
  });

  /**
   * The public origin decides one thing: whether the browser will keep the
   * session cookie at a bare `http://` address (spec-07 §"The public origin").
   * Every case here reads the `Set-Cookie` line the wire carries, and no case
   * reaches for a helper inside the transport — that header *is* the contract
   * with the browser.
   */
  describe('the session cookie follows the declared public origin', () => {
    async function loginOn(app: FastifyInstance) {
      return app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
    }

    it('drops Secure on login when the declared origin is http:', async () => {
      const app = makeApp({ publicOrigin: 'http://203.0.113.10:3001' });

      const response = await loginOn(app);

      expect(response.statusCode).toBe(200);
      const value = setCookieHeader(response);
      // The browser drops a `Secure` cookie from a non-loopback `http://`
      // origin, which is the whole bug: the login would answer 200 and the
      // next request would arrive with no cookie at all.
      expect(value).not.toContain('Secure');
      // Nothing else about the cookie moves.
      expect(value).toContain('HttpOnly');
      expect(value).toContain('SameSite=Strict');
      expect(value).toContain('Path=/');
      expect(value).toContain('Max-Age=604800');
    });

    it('drops Secure on the clear-cookie too, so logout matches login', async () => {
      const app = makeApp({ publicOrigin: 'http://203.0.113.10:3001' });
      const cookie = await login(app);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie },
      });

      expect(response.statusCode).toBe(200);
      const value = setCookieHeader(response);
      expect(value).toContain('Max-Age=0');
      // A clear-cookie that carried `Secure` where the login's did not would be
      // ignored by the same browser, leaving the session token in place.
      expect(value).not.toContain('Secure');
    });

    it('keeps Secure for a declared https: origin, and for an undeclared one', async () => {
      const proxied = makeApp({ publicOrigin: 'https://clodeck.example.com' });
      const undeclared = makeApp({ publicOrigin: null });
      const absent = makeApp();

      // The proxied route is where the app sees plain HTTP and the browser has
      // HTTPS: this variable is the only thing that can tell the two apart, and
      // a proxied deployment must lose nothing to the direct route's arrival.
      expect(setCookieHeader(await loginOn(proxied))).toContain('Secure');
      expect(setCookieHeader(await loginOn(undeclared))).toContain('Secure');
      expect(setCookieHeader(await loginOn(absent))).toContain('Secure');
    });

    it('reads the scheme, never the host', async () => {
      // A LAN address and a tunnelled loopback address declare the same thing
      // about the browser's rule; only the scheme is asked (spec-07). Matching
      // hosts would break both routes and buy nothing.
      for (const origin of [
        'http://203.0.113.10:3001',
        'http://clodeck.lan:8080',
        'http://localhost:3001',
      ]) {
        const app = makeApp({ publicOrigin: origin });

        expect(setCookieHeader(await loginOn(app)), origin).not.toContain('Secure');
      }
    });

    it('never fails open on a malformed value, and names what it ignored', async () => {
      // A forgotten scheme and a scheme no browser reaches the app on: both are
      // typos, and a typo must not be able to turn `Secure` off. Refusing to
      // boot over one was considered and rejected — a safe fallback plus a loud
      // line is recoverable, a dead server is not.
      for (const malformed of ['203.0.113.10:3001', 'ftp://example.com', 'clodeck.example.com']) {
        const warnings: string[] = [];
        const app = makeApp({ publicOrigin: malformed, warn: (message) => warnings.push(message) });

        expect(setCookieHeader(await loginOn(app)), malformed).toContain('Secure');
        // The line speaks the operator's vocabulary: the variable they set, and
        // what they set it to.
        expect(warnings.join('\n'), malformed).toContain('CLODECK_PUBLIC_URL');
        expect(warnings.join('\n'), malformed).toContain(malformed);
      }
    });
  });

  it('answers 401 to a wrong password and issues no cookie', async () => {
    const response = await makeApp().inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'not the password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'invalid password' });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers 400 when the body carries no password', async () => {
    const app = makeApp();
    const bodies = [{}, { password: 42 }, { password: null }, { password: '' }];

    for (const body of bodies) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: body });
      // `''` is a string, so it reaches the verifier and is refused as a wrong
      // password — the 400s here are the shapes that name no string at all.
      const expected = body.password === '' ? 401 : 400;
      expect(response.statusCode, JSON.stringify(body)).toBe(expected);
    }

    const empty = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(empty.statusCode).toBe(400);
  });

  it('logs every failed login', async () => {
    const warnings: string[] = [];
    const app = makeApp({ warn: (message) => warnings.push(message) });

    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' } });
    await login(app);

    // The refusal is reported; the success is not.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('127.0.0.1');
  });

  describe('the login limiter', () => {
    /** A limiter on a hand-held clock, so a lock can be driven without waiting one out. */
    function lockedClock(): { at: (ms: number) => void; limit: NonNullable<AuthOptions['loginLimit']> } {
      let now = 0;
      return {
        at: (ms) => {
          now = ms;
        },
        limit: { maxAttempts: 5, windowMs: 1000, lockMs: 1000, now: () => now },
      };
    }

    async function failLogin(app: FastifyInstance, address = '127.0.0.1'): Promise<number> {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'wrong' },
        remoteAddress: address,
      });
      return response.statusCode;
    }

    it('locks the address out after five failures, even for the right password', async () => {
      const app = makeApp({ loginLimit: lockedClock().limit });

      for (const attempt of [1, 2, 3, 4]) {
        expect(await failLogin(app), `failure ${String(attempt)}`).toBe(401);
      }
      // The fifth failure is still a plain 401 — the lock applies from the next attempt.
      expect(await failLogin(app)).toBe(401);

      const correct = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
      expect(correct.statusCode).toBe(429);
      expect(correct.headers['set-cookie']).toBeUndefined();
    });

    it('locks per address, not globally', async () => {
      const app = makeApp({ loginLimit: lockedClock().limit });

      for (let attempt = 0; attempt < 5; attempt += 1) await failLogin(app);

      const other = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
        remoteAddress: OTHER_ADDRESS,
      });
      expect(other.statusCode).toBe(200);
    });

    it('releases the address once the lock has been served', async () => {
      const clock = lockedClock();
      const app = makeApp({ loginLimit: clock.limit });

      for (let attempt = 0; attempt < 5; attempt += 1) await failLogin(app);
      expect(await failLogin(app)).toBe(429);

      clock.at(1001);
      expect(await failLogin(app)).toBe(401);

      // …and the fresh run of failures is its own count, not the old one plus one.
      clock.at(1002);
      const correct = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });
      expect(correct.statusCode).toBe(200);
    });

    it('forgets the failures behind a successful login', async () => {
      const app = makeApp({ loginLimit: lockedClock().limit });

      for (let attempt = 0; attempt < 4; attempt += 1) await failLogin(app);
      await login(app);
      for (let attempt = 0; attempt < 4; attempt += 1) await failLogin(app);

      // Eight failures in the window, but never five in a row.
      expect(await failLogin(app)).toBe(401);
    });
  });

  it('ends the session on logout and clears the cookie', async () => {
    const app = makeApp();
    const cookie = await login(app);

    const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    const value = setCookieHeader(response);
    expect(value).toContain('Max-Age=0');

    // The token is gone from the store, not merely unset in a browser.
    const after = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('treats logout as exempt and idempotent', async () => {
    const app = makeApp();

    const anonymous = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `${SESSION_COOKIE}=never-issued` },
    });

    expect(anonymous.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
  });

  describe('the WebSocket handshake', () => {
    /** The port an app is on, binding it once — `inject` and a socket share the app. */
    const ports = new WeakMap<FastifyInstance, number>();

    async function portOf(app: FastifyInstance): Promise<number> {
      const known = ports.get(app);
      if (known !== undefined) return known;

      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('the test server did not bind a port');
      }
      ports.set(app, address.port);
      return address.port;
    }

    /** What the client sees: `open`, or the error that refused the upgrade. */
    async function handshake(
      app: FastifyInstance,
      headers: Record<string, string>,
      origin?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      const url = `ws://127.0.0.1:${String(await portOf(app))}/ws`;

      return new Promise((resolve) => {
        const socket = new WebSocket(url, { headers, ...(origin === undefined ? {} : { origin }) });
        socket.on('open', () => {
          socket.close();
          resolve({ ok: true });
        });
        socket.on('error', (error: Error) => {
          resolve({ ok: false, error: error.message });
        });
      });
    }

    it('refuses an unauthenticated upgrade before a socket exists', async () => {
      const app = makeApp();

      const result = await handshake(app, {});

      expect(result.ok).toBe(false);
      expect(result.error).toContain('401');
    });

    it('accepts the upgrade once the session cookie rides the handshake', async () => {
      const app = makeApp();
      const cookie = await login(app);

      await expect(handshake(app, { cookie })).resolves.toEqual({ ok: true });
    });

    it('refuses a cross-origin handshake that carries a valid session', async () => {
      const app = makeApp();
      const port = await portOf(app);
      const cookie = await login(app);

      const foreign = await handshake(app, { cookie }, 'http://evil.example');
      const crossPort = await handshake(app, { cookie }, 'http://127.0.0.1:1');

      expect(foreign.ok).toBe(false);
      expect(foreign.error).toContain('403');
      // The port is part of the host: a same-host/different-port origin is still
      // cross-origin, and it is refused for the same reason.
      expect(crossPort.ok).toBe(false);
    });

    it('accepts a same-origin handshake to the host it was sent to', async () => {
      const app = makeApp();
      const port = await portOf(app);
      const cookie = await login(app);

      await expect(handshake(app, { cookie }, `http://127.0.0.1:${String(port)}`)).resolves.toEqual({
        ok: true,
      });
    });

    it('is unaffected by a declared public origin', async () => {
      // Deliberate: the handshake check compares `Origin`'s host to `Host` and
      // ignores the scheme, and the new variable does not reach it (spec-07).
      // It admits every host the browser actually reached — a bare LAN origin
      // and a proxied one alike — and it stays spoof-resistant, which coupling
      // it to one declared hostname would not.
      for (const publicOrigin of ['http://203.0.113.10:3001', 'https://clodeck.example.com']) {
        const app = makeApp({ publicOrigin });
        const port = await portOf(app);
        const cookie = await login(app);

        await expect(
          handshake(app, { cookie }, `http://127.0.0.1:${String(port)}`),
          publicOrigin,
        ).resolves.toEqual({ ok: true });

        const foreign = await handshake(app, { cookie }, 'http://evil.example');
        expect(foreign.ok, publicOrigin).toBe(false);
        expect(foreign.error, publicOrigin).toContain('403');
      }
    });
  });
});
