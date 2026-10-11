# 25: Install the gate — wire auth into buildApp, config/main, re-green suites

**What to build:** The running server is gated end-to-end. `buildApp` gains the `auth` seam and the gate fronts every `/api/**` route and both WebSocket routes; config reads the password and `main.ts` hashes it at startup (unset → fail-closed). Every existing suite migrates to authenticate through the real login route, so the whole app is protected and the suite stays green.

**Blocked by:** 24

**Status:** resolved

- [x] `buildApp` signature becomes `{ projects, provider, spawner, auth }`. The gate fronts every gated `/api/**` route (registered after login/logout, before `/projects`, sessions, terminal-size, files, `/auth/me`) and both `/ws` and `/ws/terminal`; `/healthz` stays exempt.
- [x] `config.ts` gains `uiPassword` — read `UI_PASSWORD` first, then `UI_PASSWORD_FILE` (file read + trim), else `null`.
- [x] `main.ts` hashes `uiPassword` at startup and builds the scrypt-backed `verifyPassword`; when unset it builds `verifyPassword: () => false` and logs a loud warning — **fail-closed**: the server boots, but every gated route and WS returns `401` and login can never succeed.
- [x] `@fastify/cookie` is registered at app root before the gate, so `request.cookies` is parsed by the time the gate's `onRequest` runs.
- [x] `test-support.ts` gains a `login(app)` helper (posts the test password, returns the `set-cookie` value); every existing route/socket suite authenticates via it — no bypass, the gate is always installed.
- [x] Auth's own end-to-end tests through `buildApp`: unauthenticated `/api/projects` → `401`, login → cookie → `200`, `/healthz` → `200` with no auth, an unauthenticated `/ws` upgrade → refused.
- [x] `npm run typecheck` and `npm test` pass — the whole suite is green against the now-gated app.

## What landed

```
server/src/app.ts                  AppOptions.auth; @fastify/cookie at root; login/logout on the `/api` scope and
                                   a nested gated scope holding /projects, sessions, terminal-size, files, /auth/me.
server/src/ws/bus.ts               takes `auth`; installWebSocketGuards on its plugin scope.
server/src/terminal/transport.ts   takes `auth`; installWebSocketGuards on its plugin scope.
server/src/config.ts               ServerConfig.uiPassword; projectsRoot/env-file split into helpers; uiPassword().
server/src/auth/options.ts         createAuthOptions(uiPassword, warn) — the production seam + fail-closed warning.
server/src/main.ts                 builds auth via createAuthOptions(config.uiPassword).
server/src/testing/dev-fake.ts     the same, so the offline loop is gated too.
server/src/test-support.ts         TEST_PASSWORD, createTestAuth(), login(app).
server/src/{app,sessions}.test.ts, server/src/{files,terminal,ws}/*.test.ts   migrated (login per suite; `authed()`
                                   in the two big route suites; a `cookie` on every socket handshake).
```

## Decisions the spec did not pin

- **The exempt/gated split is two nested scopes**, not a hook "registered between two routes" — see ticket 24's
  first decision: a hook applies to every route in its scope however late it is added. `/api` carries
  login+logout; a child scope carries the gate and everything else. Verified by the app-level test that login
  still answers 200 while `/api/projects` answers 401 on the same instance.
- **`createAuthOptions` is a module, not three lines in `main.ts`.** Two entry points boot a real server
  (`main.ts`, `testing/dev-fake.ts`) and both must fail closed the same way; putting the decision in
  `auth/options.ts` also makes it testable without a listening process (3 unit tests).
- **`dev:fake` is gated too.** The spec only names `main.ts`; the handoff's dev loop is `dev:fake`, and a dev
  loop that is open while production is closed is a rehearsal, not the same loop.
- **Suite migration style.** Two files (`app.test.ts`, `sessions.test.ts`) log in per test; the two big route
  suites (`files/transport.test.ts`, 51 calls) use a local `authed(app, options)` wrapper so the cookie belongs
  to the request shape; the socket suites have `makeApp()` return the cookie, since a handshake cannot use
  `inject`'s helpers. All of them go through the real login route — no bypass anywhere.
- **The `HOST` comment in `main.ts` was rewritten**: loopback is now defense in depth, not the boundary.

## Code review

Two-axis review (Standards: repo conventions + the Fowler smell baseline; Spec: `spec-05-auth.md` + tickets
23–26). Findings here, with adjudications:

- **Declined, recorded — "sliding idle is not end-to-end"** (Spec: story 7 vs line 99). The store slides on every
  read, but the cookie is set once at login with the pinned `Max-Age=604800`, so a browser lapses 7 days after
  login even when used daily. Left as is on purpose: the pinned constant is the cookie contract, a bounded
  session lifetime is the safer reading of "so that a stale browser doesn't stay logged in forever", and making
  the cookie slide would mean a `Set-Cookie` on *every* authenticated response — including the WS handshake
  path — for a single-user tool where a re-login every seven days is cheap. Story 7's *intent* is therefore
  served by the store (an idle session dies after 7 days) and capped by the cookie.
- **Accepted, recorded — spec scope**: `createAuthOptions` lives in `server/src/auth/options.ts` rather than
  inline in `main.ts` (spec line 123). Two entry points boot a real server and both must fail closed identically;
  the module is also what makes that decision testable (3 unit tests).
- **Accepted, recorded — spec scope**: `config.uiPassword` treats a blank `UI_PASSWORD` as unset and warns when
  `UI_PASSWORD_FILE` cannot be read. The spec pins "read the file, trim" and nothing else; the extra care matches
  what `projectsRoot` already does in the same function, and every one of those arms is pinned by a test.
- **Accepted, recorded — spec scope**: a login body that carries no string password is a `400` (spec line 105
  only pins the shape `{ password }`). The alternative for a malformed body is a 500, which is worse.
- **Confirmed clean by both axes**: exactly one new direct server dependency (`@fastify/cookie`), no
  `protocol.ts` change, the exempt set, the flag matrix, the `429`/lockout behaviour, and the fail-closed boot.

## Evidence

```
npm run typecheck                    → clean (shared → server → web)
npm test                             → server 221 passed / 7 skipped; web 84 passed
npm run build                        → clean (the >500 kB chunk notice is pre-existing, from xterm)

By hand, `PROJECTS_ROOT=D:\work\clodeck-projects UI_PASSWORD=dev-secret npx tsx src/testing/dev-fake.ts`:
  GET  /healthz                       → 200
  GET  /api/projects                  → 401
  POST /api/auth/login  (wrong)       → 401
  POST /api/auth/login  (right)       → 200 + `clodeck_session=…; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict`
  GET  /api/auth/me     + cookie      → 200 {"principal":{"id":"default","name":"default"}}
  GET  /api/projects    + cookie      → 200 (both projects)
  WS   /ws              anonymous     → 401   (upgrade refused before a socket)
  WS   /ws              cross-origin  → 403   (cookie valid, Origin http://evil.example)
  POST /api/auth/logout + cookie      → 200 + `Max-Age=0`; the same cookie afterwards → 401
Boot with UI_PASSWORD unset           → the loud warning, then 401 for login and for /api/projects (fail-closed)
```
