# 25: Install the gate — wire auth into buildApp, config/main, re-green suites

**What to build:** The running server is gated end-to-end. `buildApp` gains the `auth` seam and the gate fronts every `/api/**` route and both WebSocket routes; config reads the password and `main.ts` hashes it at startup (unset → fail-closed). Every existing suite migrates to authenticate through the real login route, so the whole app is protected and the suite stays green.

**Blocked by:** 24

**Status:** ready-for-agent

- [ ] `buildApp` signature becomes `{ projects, provider, spawner, auth }`. The gate fronts every gated `/api/**` route (registered after login/logout, before `/projects`, sessions, terminal-size, files, `/auth/me`) and both `/ws` and `/ws/terminal`; `/healthz` stays exempt.
- [ ] `config.ts` gains `uiPassword` — read `UI_PASSWORD` first, then `UI_PASSWORD_FILE` (file read + trim), else `null`.
- [ ] `main.ts` hashes `uiPassword` at startup and builds the scrypt-backed `verifyPassword`; when unset it builds `verifyPassword: () => false` and logs a loud warning — **fail-closed**: the server boots, but every gated route and WS returns `401` and login can never succeed.
- [ ] `@fastify/cookie` is registered at app root before the gate, so `request.cookies` is parsed by the time the gate's `onRequest` runs.
- [ ] `test-support.ts` gains a `login(app)` helper (posts the test password, returns the `set-cookie` value); every existing route/socket suite authenticates via it — no bypass, the gate is always installed.
- [ ] Auth's own end-to-end tests through `buildApp`: unauthenticated `/api/projects` → `401`, login → cookie → `200`, `/healthz` → `200` with no auth, an unauthenticated `/ws` upgrade → refused.
- [ ] `npm run typecheck` and `npm test` pass — the whole suite is green against the now-gated app.
