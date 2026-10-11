# 24: Auth transport — login/logout/me, cookie, gate hook, rate-limit, origin check

**What to build:** The auth transport module: the three routes, the cookie handling, the reusable `onRequest` gate hook, per-IP login rate-limit + lockout, and the WebSocket origin check. Self-tested against a test app — the gate is exported but **not yet installed** in `buildApp` (that is ticket 25).

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] `server/src/auth/transport.ts` exports `registerAuthRoutes` (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) and the reusable `onRequest` gate hook; adds `@fastify/cookie` (the one new dependency).
- [ ] `POST /api/auth/login` body `{ password }`: `verifyPassword` → `sessions.create({ id: 'default', name: 'default' })` → `Set-Cookie: clodeck_session=…; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` → `200 { ok: true }`; wrong password → `401 { error }`; locked → `429 { error }`.
- [ ] `POST /api/auth/logout`: destroy the named session (if any) + clear the cookie (`Max-Age=0`) → `200 { ok: true }` — exempt and idempotent.
- [ ] `GET /api/auth/me`: `200 { principal: { id: 'default', name: 'default' } }` or `401`.
- [ ] The gate hook reads `clodeck_session` → `sessions.get` → attaches `request.principal`; otherwise replies `401 { error }`. It is reusable so ticket 25 can front `/api/**`, `/ws`, and `/ws/terminal` with it.
- [ ] Per-IP login rate-limit + lockout, tuned by `loginLimit` (`maxAttempts`/`windowMs`/`lockMs`/`now`; defaults 5 / 15 min / 15 min): five failures lock the IP for `lockMs` (even a correct password → `429`), and every failure is logged.
- [ ] A WebSocket origin-check helper refuses a handshake whose `Origin` is present and not same-origin to `Host`; a client with no `Origin` passes.
- [ ] Self-tests (inject/handshake): 401 unauthenticated, 200 after login with the returned cookie, the `Set-Cookie` flag matrix, wrong password → 401, five failures → 429, logout clears, mismatched `Origin` refused.
