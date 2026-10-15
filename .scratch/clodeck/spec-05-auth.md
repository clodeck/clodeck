# Clodeck — auth slice (single-account login, cookie session, gated surface)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Ta inja chat ✓, history/resume ✓, terminal ✓, file drawer ✓ — hame-ye MVP-e core sakhte shode, amma **hame-ye `/api/**`, `/ws`, va `/ws/terminal` unauthenticated hastand**. `main.ts` be hamin khater loopback bind mikone (`127.0.0.1`) va comment-e khodesh mige "must not be reachable from the network until the auth slice lands." Yani hamin alan ham, agar `HOST=0.0.0.0` set beshe, har ki port ro balad bashe mitone ye project ro browse/hazf/rename kone, ye shell begire, ya ba Agent SDK prompt bezane — faghat ba `projectId`-i ke decode mishe. Allowlist (realpath containment) project-ha ro az ham joda mikone, amma **kasi ro az project-ha joda nemikone**.

Riski-tarin bakhsh in ast ke auth ya'ni **ye boundary-e identity dar ye system-i ke ta alan boundary-e id nadārad**. Hame-ye slice-ha-ye ghabli "id = identifier, na credential" ro tekrar karde-and; auth oon credential-e gomshode-st. Dovomin chalesh: chat va terminal **WebSocket**-and, na REST, va browser nemitone rooye upgrade-e WS `Authorization` header bezare — pas mekanism-e session bayad chizi bashe ke **be sorat-e khodkar rooye same-origin WS miravad**: ye httpOnly cookie (decision 07). Sevomin: hich ja-ye code alan cookie/session/password nemishenasad, pas in slice ye module-e jadid-e kamel ast, na taghir-e ye raftar-e mojood.

## Solution

Ye **cookie session-e server-side** ezafe mikonim (tebghe decision 07): login-e single-account ba `POST /api/auth/login`, ye httpOnly cookie (`Secure`, `SameSite=Strict`), ye session store-e in-memory **posht-e ye interface**, va ye hook-e **principal-aware** ke hame-ye `/api/**` va `/ws**` ro gate mikone. Password az `UI_PASSWORD`/`UI_PASSWORD_FILE` miad, dar startup ba **Node `crypto.scrypt`** (memory-hard + timing-safe, bedune native dep) hash mishe, va login timing-safe compare mikone.

Boundary-e authorization **binary** ast dar amal (authenticated ya na), amma hook ye principal-e sābet `{ id: "default", name: "default" }` resolve mikone — seam-i ke ba'd multi-user ro "parameterize with an actor" mikone, na rewrite (decision 07 §4). TLS dar proxy (Caddy, slice 08) terminate mishe; cookie `Secure` **hamishe** set mishe, va chon browser-ha Secure cookie ro rooye `http://localhost` ejaze midan, dev loop-e Vite ham be hamoon shekl kar mikone.

**No protocol.ts change.** Auth REST + cookie + reject-e WS handshake ast — hich taghiri dar envelope-e `/ws` ya `protocol.ts` nist (hamoon qa'ede-ye terminal/file).

## User Stories

1. As a single user, I want a login screen, so that the UI is not open to the network.
2. As the user, I want to authenticate with a password only, so that I don't manage usernames.
3. As the user, I want my login to persist as a session cookie, so that I don't re-enter the password on every reload.
4. As the user, I want the session cookie to be httpOnly, so that page JS (and any XSS) cannot read it.
5. As the user, I want the cookie `Secure` + `SameSite=Strict`, so that it is only sent over HTTPS and only same-origin (anti-CSRF).
6. As the user, I want a logout button that destroys the server-side session, so that I can end my session on a shared machine.
7. As the user, I want my session to expire after 7 idle days (sliding), so that a stale browser doesn't stay logged in forever.
8. As an operator, I want the password supplied as `UI_PASSWORD` (or `UI_PASSWORD_FILE`), so that I can configure it via env/secret without touching code.
9. As an operator, I want the password held only as a salted scrypt hash, never plaintext at rest, so that a leaked config can't expose it directly.
10. As an operator, I want a timing-safe comparison, so that login timing doesn't leak password validity.
11. As an operator, I want every `/api/**` and `/ws**` endpoint gated, so that nothing is reachable unauthenticated.
12. As an operator, I want `/healthz` exempt, so that Docker/proxy healthchecks still work.
13. As an operator, I want a fail-closed boot when `UI_PASSWORD` is unset, so that a misconfigured server is never open.
14. As an operator, I want the SPA bundle public while data endpoints are gated, so that the login screen can load without a session.
15. As an operator, I want login brute-force protection (per-IP rate limit + lockout), so that a single password can't be brute-forced.
16. As an operator, I want failed logins logged, so that I can see attempts.
17. As a developer, I want the auth boundary to resolve a fixed `"default"` principal, so that multi-user scoping is an additive change, not a rewrite.
18. As a developer, I want the session store behind an interface, so that Redis/DB can swap in later.
19. As a developer, I want the WebSocket upgrades authenticated by the same cookie (not a query-string token), so that no credential leaks into access logs.
20. As an operator, I want WS upgrades to verify `Origin` (same-origin) when present, so that cross-site WS hijacking is refused.
21. As a frontend developer, I want a `useAuth` seam mirroring `useProjects`/`useChat`, so that auth state is owned in one place.
22. As a frontend developer, I want the whole shell gated behind the login screen, so that no panel mounts (and no socket opens) before login.

## Implementation Decisions

### The seam — `auth` on `buildApp` (one new injected seam)

- `buildApp` signature becomes `{ projects, provider, spawner, auth }`. `auth` is the fourth, and last, injected seam; the existing three are untouched.
- `auth` carries the two things the gate needs, plus test-facing rate-limit tuning:

```ts
export interface AuthOptions {
  /** The credential to compare logins against. Prod: scrypt-backed; tests: a trivial check. */
  verifyPassword(password: string): Promise<boolean>;
  /** The server-side session store behind the cookie — the seam for Redis later. */
  sessions: SessionStore;
  /** Login brute-force tuning — test-facing overrides; defaults live in the module. */
  loginLimit?: { maxAttempts: number; windowMs: number; lockMs: number; now?: () => number };
}
```

- **Why `verifyPassword` and not a hash value:** the gate must never touch scrypt in tests (scrypt is deliberately slow). Injecting the *function* lets prod pass a scrypt-backed verifier and every other suite pass `(pw) => pw === 'test-password'`. The real scrypt function is tested directly in one file.
- **Why `sessions` and not a raw `Map`:** decision 07 §5 — the interface is the swap point for Redis/DB, the same posture as `ProjectDiscovery` (05) and `SdkProvider` (06/02).
- **The gate is always installed** — there is no `auth: null` bypass. `verifyPassword` returning false forever (fail-closed) is how "no password configured" is expressed, not by removing the hook.

### Password — Node `crypto.scrypt`, timing-safe (no native dep)

- `server/src/auth/password.ts` exports `hashPassword(plaintext): Promise<string>` and `verifyPassword(plaintext, hash): Promise<boolean>`.
- `hashPassword`: a per-password random 16-byte salt, `crypto.scrypt` with OWASP-consistent params (`N=16384, r=8, p=1`), and a self-describing storage string `scrypt$N$r$p$<salt>$<hash>` (base64). `verifyPassword` re-derives with the stored params and compares with `crypto.timingSafeEqual` over the derived key (not a string compare).
- **Deviation recorded:** decision 07 said "bcrypt/argon2"; the user chose the built-in `crypto.scrypt` (memory-hard, timing-safe, zero new native dependency — relevant because node-pty is already one native binding and the Docker slice must stay glibc-only). Same security posture, one less dep.
- `hashPassword` runs once at startup; `verifyPassword` runs per login attempt.

### Session store — in-memory behind an interface, sliding idle

```ts
export type Principal = { id: string; name: string }; // shared, `shared/src/auth.ts`

export interface Session {
  id: string;        // the cookie value — 32 random bytes, base64url
  principal: Principal;
  expiresAt: number; // epoch ms — sliding
}

export interface SessionStore {
  get(id: string): Session | undefined;   // slides expiry on hit; expired entries are dropped
  create(principal: Principal): Session;
  destroy(id: string): void;
}
```

- The session id is `crypto.randomBytes(32).toString('base64url')` — an opaque CSPRNG token. **No signing** (JWT rejected in decision 07): the cookie is just a key into the server-side store, so a logout/restart invalidates it by deletion, not by signature.
- `createSessionStore({ idleMs = 7 days, now = Date.now })` — the injectable `now` is what makes sliding-idle and expiry testable. `get` drops an expired entry on read; no background sweeper (single-user scale).
- `Principal` is the one new shared wire shape; `shared/src/index.ts` re-exports `./auth.js`.

### Cookie — `@fastify/cookie`, one cookie, `Secure` unless the origin is declared

- `@fastify/cookie` is the single new server dependency, registered at app root (before the gate, so `request.cookies` is parsed by the time the gate's `onRequest` runs).
- One cookie, name `clodeck_session`, flags: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, `Max-Age=604800` (the 7-day idle window). No signed cookie — the value is an opaque token, not something to verify.
- **`Secure` is always on** (decision 07 mandates "HTTPS only"). The dev loop still works because browsers exempt `http://localhost` from the `Secure` requirement; prod is HTTPS via Caddy. No `COOKIE_SECURE` off-switch in MVP. **Superseded 2026-10-15:** the flag follows the scheme of the declared public origin (`CLODECK_PUBLIC_URL`) — unset keeps exactly this behaviour — so a bare `http://` origin can hold a login, in cleartext, warned about at startup and on the login screen. See `docs/adr/0001-session-cookie-follows-public-origin.md` and `spec-07-direct-route.md`.

### Routes + the gate

- **Exempt routes:** `/healthz` (already at root), `POST /api/auth/login`, `POST /api/auth/logout`.
- **`POST /api/auth/login`** body `{ password: string }` → `verifyPassword` → `sessions.create({ id: 'default', name: 'default' })` → `Set-Cookie` → `200 { ok: true }`; wrong password → `401 { error }`; locked → `429 { error }`.
- **`POST /api/auth/logout`** → `sessions.destroy` (if the cookie names a session) → clear cookie (`Max-Age=0`) → `200 { ok: true }`. Exempt and idempotent — logging out with an already-unknown/expired cookie still clears it.
- **`GET /api/auth/me`** (gated) → `200 { principal: { id: 'default', name: 'default' } }` or `401`.
- **The gate** is one `onRequest` hook: read `clodeck_session` → `sessions.get` → attach `request.principal`; else `reply.code(401).send({ error })`. It is registered:
  1. inside the `/api` scope, **after** login/logout and **before** every gated route (`/projects`, `/projects/:id/sessions`, `/projects/:id/terminal/size`, `/files…`, `/auth/me`); and
  2. in the `/ws` and `/ws/terminal` plugins, before their routes — a `401` reply rejects the upgrade before a socket exists (Fastify runs the normal hook chain on a `websocket: true` route's handshake).
- **WS origin check (closes a gap decision 02 declared but never built):** on `/ws` and `/ws/terminal`, when the handshake carries an `Origin`, it must be same-origin to `Host` or the upgrade is refused; a client with no `Origin` (curl, non-browser) passes. This is *in addition to* the cookie, and only on the two WS routes.
- `request.principal` is attached today so the seam exists; no route consumes it yet (binary auth), but the value is the multi-user attach-point.

### Login brute-force — per-IP rate limit + lockout

- An in-memory per-IP counter lives in the auth transport (not a separate service). Defaults `maxAttempts: 5`, `windowMs: 15 min`, `lockMs: 15 min`, `now: Date.now`.
- Five failures within the window → locked for `lockMs`; during lockout even a *correct* password gets `429`. Every failed login is logged (reuse `logging.ts`'s `Warn`).
- The `loginLimit` field on `AuthOptions` lets tests shrink the window and drive a fake `now`; prod uses the defaults.

### Config + main wiring

- `loadConfig` gains `uiPassword` — read `UI_PASSWORD` first, then `UI_PASSWORD_FILE` (read the file, trim). Unset → `null`.
- `main.ts`: if `uiPassword` is present, `hashPassword` it at startup and build the scrypt verifier; if absent, build `verifyPassword: () => false` and log a loud warning — **fail-closed**: the server boots, but every gated route (and every WS) returns `401`, and login can never succeed. This is the same posture as "unconfigured projects = empty list, logged" — boot and warn, never open.
- `HOST`/`PORT` unchanged; the loopback default stays as defense-in-depth, not as the auth boundary.

### Shared + web client

- `shared/src/auth.ts`: `Principal`; re-export from `index.ts`. `protocol.ts` is untouched.
- `web/src/auth/`: `transport.ts` (the `login`/`logout`/`me` fetch layer, no React — testable under the node environment like `files/transport.ts`), `useAuth.ts` (`{ status: 'checking' | 'authenticated' | 'unauthenticated', principal, login, logout }`), and `LoginScreen.tsx` (password field; 401 → error, 429 → lockout message).
- `App.tsx` gates the whole shell: `checking` → spinner, `unauthenticated` → `<LoginScreen/>`, `authenticated` → the existing layout. A logout control joins the sidebar header. The browser sends the cookie automatically on the same-origin `/ws` and `/ws/terminal` upgrades, so the socket code needs no change.
- **Mid-session expiry** (7 days idle) surfaces as the existing error states; the recovery path is reload → login screen. No global 401 interceptor in MVP.

## Testing Decisions

- **What makes a good test:** assert external behavior — status code + cookie flags + body shape — never private helpers. The real scrypt function is the one unit-test exception (round-trip, wrong-password false, salt uniqueness), because `verifyPassword` is otherwise faked at the seam.
- **The seams:**
  1. **`buildApp({ …, auth })` via `app.inject()`** — the highest seam. Auth's own tests assert: `/api/projects`, `/api/auth/me`, and a `/ws` upgrade are `401` unauthenticated; after `POST /api/auth/login` with the test password and the returned `set-cookie` attached, the same calls are `200`; the `Set-Cookie` header carries `HttpOnly; Secure; SameSite=Strict`; wrong password → `401`; five failures → `429` even with the right password; `/healthz` stays `200`; a WS upgrade with a mismatched `Origin` is refused.
  2. **`verifyPassword`** is injected as `(pw) => pw === 'test-password'` in every suite except `password.test.ts`, which exercises the real scrypt. **`sessions`** is the real in-memory store with an injected `now` clock, so sliding-idle and expiry are deterministic.
- **Prior art:** `sessions.test.ts` / `files/transport.test.ts` for `inject()` route tests; `terminal/transport.test.ts` / `ws/bus.test.ts` for the WS handshake tests (extend them to assert the unauthenticated handshake is rejected); `scoped-fs.test.ts` for real-fixture unit tests; `test-support.ts` for the shared sandbox helper.
- **Every existing suite now authenticates.** Add a `login(app): Promise<string>` helper to `test-support.ts` that posts the test password and returns the `set-cookie` value; each existing route/socket test attaches `cookie: await login(app)`. The gate is always installed — there is no bypass — so this is mechanical, one line per test, and keeps each suite asserting *its* slice rather than re-testing auth.
- **Non-goal:** no browser e2e, no real scrypt in the route suite (too slow), no Redis.

## Out of Scope

- **Multi-user / per-user ACL.** Binary "default" principal only; the `request.principal` seam is the attach-point, but no per-user scoping of projects/sessions lands here.
- **Redis/DB session store** — the `SessionStore` interface is the seam; the backing store stays in-memory.
- **TLS termination at the app (direct-TLS fallback).** Caddy terminates TLS in the Docker slice (wayfinder 08). The cookie `Secure` flag is set regardless; cert/key wiring is not this slice.
- **CSRF token.** `SameSite=Strict` + JSON-only bodies + same-origin (no CORS) suffice for a single-user tool (decision 07 §8).
- **CAPTCHA / account lockout UI** beyond the `429` message; no "reset password" flow.
- **Global 401 interceptor** for mid-session expiry (reload → login screen is the recovery).
- **Docker image / compose / Caddy** — wayfinder 08, the next slice.
- Git explorer, plugins, browser-use, model picker — out-of-MVP per `AGENTS.md`.

## Further Notes

- **`protocol.ts` remains frozen** (handoff): auth rides REST + cookies + a rejected WS handshake, never the `/ws` JSON envelope. `shared/src/auth.ts` is a sibling of `files.ts`/`session.ts`, not an edit to them.
- **Dev loop now needs a password.** `set UI_PASSWORD=dev && set PROJECTS_ROOT=D:\work\clodeck-projects && npm run dev` (cmd). `dev:fake` too. Without it the server boots fail-closed and the login screen can't get past — that's the intended posture, not a bug.
- **Ticket split** (continues from `22`, for `/to-tickets`):
  - (23) shared `Principal` + `password.ts` (scrypt hash/verify, timing-safe) + `sessions.ts` (`Session`, `SessionStore`, in-memory sliding-idle store) — unit tests.
  - (24) `transport.ts` (login/logout/me routes, cookie set/clear, the `onRequest` gate, per-IP rate-limit/lockout, WS origin check) — `inject()` + WS-handshake tests.
  - (25) wire into `buildApp` (`auth` option, `/api` scope gate + `/ws`/`/ws/terminal` front) + `config.ts`/`main.ts` (`UI_PASSWORD`/`UI_PASSWORD_FILE`, startup hash, fail-closed) + migrate existing suites to `login(app)`.
  - (26) web `transport.ts` + `useAuth` + `LoginScreen` + `App.tsx` gate + logout — tests.
- **`@fastify/cookie`** is the one new server dependency; register it at app root before the gate (its own `onRequest` parsing hook must run first). No signed-cookie secret, no session signing.
- **The origin check is new, not a re-check:** decision 02 required it but `bus.ts`/`terminal/transport.ts` never built it. This slice lands it, scoped to the two WS routes, so "same cookie + same origin" both hold before any socket opens.
