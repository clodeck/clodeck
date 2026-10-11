import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';

import type { Principal } from '@clodeck/shared';

// Type-only: this module *uses* `@fastify/cookie`'s decorators (`request.cookies`,
// `reply.setCookie`), and importing the package is what brings its declaration
// merging into the program. The plugin itself is registered once, by the app
// that owns the root (see `app.ts`).
import type {} from '@fastify/cookie';

import { warnToConsole, type Warn } from '../logging.js';
import { DEFAULT_IDLE_MS, type Session, type SessionStore } from './sessions.js';

// The gate's one addition to the request. Optional because most requests (and
// every request in a suite that never installs the gate) have none; inside a
// gated scope `principalOf` turns "must be there" into a thrown wiring error.
declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/**
 * The auth transport (spec-05 §"Routes + the gate"): the three REST routes that
 * create, end and describe a session, and the two reusable `onRequest` hooks
 * that front everything else.
 *
 * The gate is *always* installed — there is no bypass, and no route opts out by
 * being absent from a list. What makes the exempt routes exempt is where they
 * are registered: a hook belongs to an encapsulation scope and applies to every
 * route in it, so login/logout live on a scope without the gate and everything
 * else lives inside one with it (see `app.ts`). That is why the gate cannot be
 * "installed after login/logout": Fastify resolves a scope's hooks when the
 * whole tree is ready, not when each route is added.
 */

/** The session cookie. One cookie, one name, no second flavour. */
export const SESSION_COOKIE = 'clodeck_session';

/**
 * The cookie's `Max-Age`, in seconds, mirroring the store's idle window: the
 * browser and the server agree on when a session lapses, and the server is the
 * one that decides.
 */
const SESSION_MAX_AGE_SECONDS = Math.floor(DEFAULT_IDLE_MS / 1000);

/** The only principal this slice resolves (spec-05 §"The gate"). */
const DEFAULT_PRINCIPAL: Principal = { id: 'default', name: 'default' };

/** The per-IP login limiter's defaults (spec-05 §"Login brute-force"). */
const DEFAULT_LOGIN_LIMIT: Required<LoginLimit> = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
  now: Date.now,
};

export interface LoginLimit {
  /** Failures within the window that lock the address. */
  maxAttempts: number;
  /** How long a run of failures is remembered. */
  windowMs: number;
  /** How long an address stays locked once it trips. */
  lockMs: number;
  /** The clock. Injectable so a lockout can be driven without waiting one out. */
  now?: () => number;
}

/**
 * The `auth` seam on `buildApp` — the fourth, and last, injected dependency.
 *
 * `verifyPassword` is injected as a *function*, not a hash, so no suite but
 * `password.test.ts` ever touches scrypt (it is deliberately slow); production
 * passes the scrypt-backed verifier and every other suite passes a trivial one.
 * `sessions` is injected as an interface because that is the swap point for
 * Redis/DB (decision 07 §5), the same posture as `ProjectDiscovery`.
 */
export interface AuthOptions {
  /** Compare a login attempt against the configured credential. */
  verifyPassword(password: string): Promise<boolean>;
  /** Where sessions live. In-memory today; the interface is the seam. */
  sessions: SessionStore;
  /** Login brute-force tuning — test-facing overrides; the defaults live here. */
  loginLimit?: LoginLimit;
  /** Where a refused login is reported. Defaults to the console. */
  warn?: Warn;
}

/**
 * Register the exempt half: `POST /api/auth/login` and `POST /api/auth/logout`.
 * Call this on a scope that does *not* carry the gate.
 */
export function registerAuthRoutes(api: FastifyInstance, options: AuthOptions): void {
  const warn = options.warn ?? warnToConsole;
  const limiter = createLoginLimiter(options.loginLimit ?? DEFAULT_LOGIN_LIMIT);

  api.post<{ Body: unknown }>('/auth/login', async (request, reply) => {
    const password = readPassword(request.body);
    if (password === null) return reply.code(400).send({ error: 'password must be a string' });

    // The lock is checked *before* the password, so a locked address cannot use
    // the endpoint to burn scrypt cycles, and a correct password is still a 429.
    if (limiter.isLocked(request.ip)) {
      return reply.code(429).send({ error: 'too many failed attempts; try again later' });
    }

    if (!(await options.verifyPassword(password))) {
      limiter.recordFailure(request.ip);
      warn(`failed login attempt from ${request.ip}`);
      return reply.code(401).send({ error: 'invalid password' });
    }

    limiter.recordSuccess(request.ip);
    const session = options.sessions.create(DEFAULT_PRINCIPAL);
    setSessionCookie(reply, session.id);
    return reply.send({ ok: true });
  });

  // Exempt and idempotent: ending a session that is already gone (or was never
  // there) still has to clear the cookie and answer 200.
  api.post('/auth/logout', async (request, reply) => {
    const id = readSessionId(request);
    if (id !== undefined) options.sessions.destroy(id);

    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });
}

/**
 * Register the gated `GET /api/auth/me`. Call this on a scope that *does* carry
 * the gate — the handler reads the principal the gate attached, and cannot
 * answer without it.
 */
export function registerAuthMeRoute(gated: FastifyInstance): void {
  gated.get('/auth/me', async (request) => ({ principal: principalOf(request) }));
}

/**
 * The gate. It reads the session cookie, asks the store, and either attaches
 * `request.principal` or answers `401` — before the route handler, and (on a
 * `websocket: true` route) before any socket exists, because Fastify runs the
 * normal hook chain on the handshake.
 */
export function createAuthGate(sessions: SessionStore): onRequestHookHandler {
  return async (request, reply) => {
    const session = readSession(request, sessions);
    if (session === undefined) {
      return reply.code(401).send({ error: 'authentication required' });
    }

    request.principal = session.principal;
  };
}

/**
 * Refuse a handshake whose `Origin` is present and not same-origin to `Host`
 * (decision 02, never built until now). A client that sends no `Origin` — curl,
 * a native client, the test suite — passes: the check is anti-CSRF against a
 * *browser*, not a general client policy.
 */
export function createOriginGuard(): onRequestHookHandler {
  return async (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(403).send({ error: 'cross-origin handshake refused' });
    }
  };
}

/**
 * Front a scope of WebSocket routes with both handshake guards: origin first
 * (no state to consult), then the cookie gate. Both reply before the upgrade,
 * so a refused handshake never becomes a socket.
 */
export function installWebSocketGuards(scope: FastifyInstance, options: AuthOptions): void {
  scope.addHook('onRequest', createOriginGuard());
  scope.addHook('onRequest', createAuthGate(options.sessions));
}

/**
 * The principal the gate attached. A route registered outside a gated scope
 * reaches this and throws: an absent principal is a wiring bug, not a state to
 * invent a fallback for.
 */
export function principalOf(request: FastifyRequest): Principal {
  const principal = request.principal;
  if (principal === undefined) {
    throw new Error('no principal on the request: the auth gate is not installed on this route');
  }
  return principal;
}

/** The session a request's cookie names, or `undefined` — expiry included, via the store. */
function readSession(request: FastifyRequest, sessions: SessionStore): Session | undefined {
  const id = readSessionId(request);
  return id === undefined ? undefined : sessions.get(id);
}

function readSessionId(request: FastifyRequest): string | undefined {
  const id = request.cookies?.[SESSION_COOKIE];
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** A login request's `password`: a string, or `null` for anything else. */
function readPassword(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const password = (body as Record<string, unknown>)['password'];
  return typeof password === 'string' ? password : null;
}

/**
 * `Secure` is always set (decision 07): browsers exempt `http://localhost` from
 * the requirement, so the dev loop still works, and production is HTTPS via the
 * proxy. There is no off-switch to forget to turn back on.
 */
function setSessionCookie(reply: FastifyReply, id: string): void {
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, '', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 0,
  });
}

/**
 * `Origin`'s host against the request's `Host`. The scheme is deliberately not
 * compared: `Origin` carries one and `Host` does not, and a proxy that
 * terminates TLS is exactly the deployment this slice assumes.
 */
function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;

  const host = request.headers.host;
  if (host === undefined) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    // An unparsable Origin is not a same-origin one.
    return false;
  }
}

/** A failure run per address: the window it started in, and when it (if ever) locked. */
interface Attempt {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

interface LoginLimiter {
  /** Whether the address is locked out right now — checked before the password. */
  isLocked(key: string): boolean;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
}

/**
 * The in-memory per-IP limiter (spec-05 §"Login brute-force"): five failures in
 * the window lock the address for `lockMs`. No sweeper — a stale entry is
 * dropped the next time that address is seen, which is the only time it matters
 * at this scale (single user, one address).
 */
function createLoginLimiter(limit: LoginLimit): LoginLimiter {
  const now = limit.now ?? Date.now;
  const attempts = new Map<string, Attempt>();

  return {
    isLocked(key) {
      const attempt = attempts.get(key);
      if (attempt === undefined) return false;

      const at = now();
      if (attempt.lockedUntil > at) return true;

      // A lock that has been served, or a window that has slid past, is spent:
      // the next failure starts a fresh run rather than inheriting an old count.
      if (attempt.lockedUntil !== 0 || at - attempt.firstAt > limit.windowMs) attempts.delete(key);
      return false;
    },

    recordFailure(key) {
      const at = now();
      const attempt = attempts.get(key) ?? { count: 0, firstAt: at, lockedUntil: 0 };

      attempt.count += 1;
      if (attempt.count >= limit.maxAttempts) attempt.lockedUntil = at + limit.lockMs;
      attempts.set(key, attempt);
    },

    // A login that succeeds is proof the address is not being brute-forced, so
    // the run of failures behind it is forgotten.
    recordSuccess(key) {
      attempts.delete(key);
    },
  };
}
