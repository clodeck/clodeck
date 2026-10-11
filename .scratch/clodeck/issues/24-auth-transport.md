# 24: Auth transport — login/logout/me, cookie, gate hook, rate-limit, origin check

**What to build:** The auth transport module: the three routes, the cookie handling, the reusable `onRequest` gate hook, per-IP login rate-limit + lockout, and the WebSocket origin check. Self-tested against a test app — the gate is exported but **not yet installed** in `buildApp` (that is ticket 25).

**Blocked by:** 23

**Status:** resolved

- [x] `server/src/auth/transport.ts` exports `registerAuthRoutes` (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) and the reusable `onRequest` gate hook; adds `@fastify/cookie` (the one new dependency).
- [x] `POST /api/auth/login` body `{ password }`: `verifyPassword` → `sessions.create({ id: 'default', name: 'default' })` → `Set-Cookie: clodeck_session=…; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` → `200 { ok: true }`; wrong password → `401 { error }`; locked → `429 { error }`.
- [x] `POST /api/auth/logout`: destroy the named session (if any) + clear the cookie (`Max-Age=0`) → `200 { ok: true }` — exempt and idempotent.
- [x] `GET /api/auth/me`: `200 { principal: { id: 'default', name: 'default' } }` or `401`.
- [x] The gate hook reads `clodeck_session` → `sessions.get` → attaches `request.principal`; otherwise replies `401 { error }`. It is reusable so ticket 25 can front `/api/**`, `/ws`, and `/ws/terminal` with it.
- [x] Per-IP login rate-limit + lockout, tuned by `loginLimit` (`maxAttempts`/`windowMs`/`lockMs`/`now`; defaults 5 / 15 min / 15 min): five failures lock the IP for `lockMs` (even a correct password → `429`), and every failure is logged.
- [x] A WebSocket origin-check helper refuses a handshake whose `Origin` is present and not same-origin to `Host`; a client with no `Origin` passes.
- [x] Self-tests (inject/handshake): 401 unauthenticated, 200 after login with the returned cookie, the `Set-Cookie` flag matrix, wrong password → 401, five failures → 429, logout clears, mismatched `Origin` refused.

## What landed

```
server/src/auth/transport.ts        SESSION_COOKIE, AuthOptions (verifyPassword/sessions/loginLimit/warn),
                                    LoginLimit, registerAuthRoutes (login+logout, exempt),
                                    registerAuthMeRoute (gated), createAuthGate, createOriginGuard,
                                    installWebSocketGuards, principalOf; createLoginLimiter, isSameOrigin.
                                    Module augmentation: `FastifyRequest.principal?: Principal`.
server/src/auth/transport.test.ts   17 tests — 401 unauthenticated (route + /me), login → cookie → 200,
                                    the flag matrix, 401 wrong password, 400 bad bodies, failed-login logging,
                                    the limiter (lockout, per-IP, release, success resets), logout destroys +
                                    is idempotent, WS: 401 without a cookie / open with one / 403 cross-origin.
package.json (server)               + @fastify/cookie ^11.1.3 (installed: 11.1.3).
```

The `AuthOptions` seam, the cookie helpers and the two hook factories landed together in this one module, as the
ticket asks. `registerAuthRoutes` is split from `registerAuthMeRoute` because the two halves land on *different
scopes* — see the first decision below.

## Decisions the spec did not pin

- **The gate cannot be "registered after login/logout" in one scope.** Fastify resolves a scope's hooks at
  `preReady`, not at route-registration time, so an `onRequest` hook added to the `/api` scope after
  `registerAuthRoutes` still gates login and logout (`avvio.once('preReady')` → `this[kHooks][hook]`). Verified
  against fastify 5.12.5. So the split is explicit: `registerAuthRoutes` registers the exempt pair and installs
  **no** hook, and `registerAuthMeRoute` exists for the gated side. Ticket 25 puts them on two nested scopes.
- **`createOriginGuard` is a second hook, not a flag on the gate.** The two are ordered deliberately (origin
  first: no state to consult) and installed together by `installWebSocketGuards`, so the WS modules and the test
  app share one definition of "the handshake guards".
- **A `403` (not a `401`) for a cross-origin handshake**, and the check runs even for an authenticated client —
  the cookie is not a CSRF defence by itself.
- **`Origin`'s scheme is not compared.** `Origin` carries one and `Host` does not, and TLS-terminating proxies
  are exactly this slice's deployment; the port *is* part of the comparison (a same-host/different-port origin is
  refused).
- **A correct login clears the failure run** (`recordSuccess` deletes the entry), so four failures, a success,
  then four more is not a lockout. The spec only pins "five failures in the window"; this is the choice made
  where it was silent.
- **A spent lock or a stale window is dropped on the next `isLocked`**, so the run after a lockout starts from
  zero instead of inheriting the old count. No background sweeper — the same lazy posture as the session store.
- **A failed login is logged with the address** (`failed login attempt from <ip>`); a success logs nothing.
- **The `warn` sink on `AuthOptions`** was added so a suite can assert "every failure is logged" without
  capturing the console.

## Code review

Two-axis review (Standards: repo conventions + the Fowler smell baseline; Spec: `spec-05-auth.md` + tickets
23–26). Findings on this module, with adjudications:

- **Declined — Divergent Change**: `transport.ts` (~310 lines) also holds the login limiter and `isSameOrigin`.
  spec-05 §"Login brute-force" pins where the counter lives: "An in-memory per-IP counter lives in the auth
  transport (not a separate service)". A documented spec line overrides a smell; and the alternative (a
  `limiter.ts`) buys a module boundary the slice does not otherwise need.
- **Declined — Duplicated Code**: the `failureMessage` status-to-message mapping is now the third copy in `web/`
  (`files/transport.ts`, `chat/useSessions.ts`, `auth/transport.ts`). The same decline the terminal and file
  slices recorded: each transport owns its own error text, and folding three transports behind one HTTP module is
  a repo-wide refactor, not this slice.
- **Declined — Duplicated Code (tests)**: `auth/transport.test.ts` re-inlines what `test-support.ts` exports.
  Deliberate: this suite is what *validates* the login route and the cookie flag matrix, so borrowing the
  suite-wide `login()` helper (whose whole job is to make auth invisible to other suites) would make the test
  check its own scaffolding. `createTestAuth` is not used here for the same reason — this app needs a warn sink
  and a mockable verifier, not the shared quiet one.
- **Accepted, recorded — Spec scope**: `AuthOptions` gained `warn?: Warn` beyond the pinned
  `{ verifyPassword, sessions, loginLimit? }`. The spec requires failed logins to be logged ("reuse
  `logging.ts`'s `Warn`") but names no sink, and the sibling seams (`ProjectDiscovery`, `loadConfig`) both take
  an injected `warn`; the field is what makes "every failure is logged" assertable without capturing the console.
  Same shape as `loginLimit?` — a test-facing override on the same seam.

## Evidence

```
npx vitest run src/auth/transport.test.ts   → 17 passed
npm run typecheck                           → clean
```
