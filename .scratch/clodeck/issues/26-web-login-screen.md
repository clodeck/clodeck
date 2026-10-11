# 26: Web login screen + auth client

**What to build:** The browser login experience. A `useAuth` seam (mirroring `useProjects`) owns auth state; a `LoginScreen` collects the password; `App.tsx` gates the whole shell so no panel mounts and no socket opens before login. The cookie rides the same-origin `/ws` and `/ws/terminal` upgrades automatically, so the socket code needs no change.

**Blocked by:** 25

**Status:** ready-for-agent

- [ ] `web/src/auth/transport.ts` exposes `login(password)`, `logout()`, and `fetchMe()` — a fetch layer with no React, testable under the node environment like `files/transport.ts`.
- [ ] `web/src/auth/useAuth.ts` exposes `{ status: 'checking' | 'authenticated' | 'unauthenticated', principal, login, logout }`, booting from `GET /api/auth/me`.
- [ ] `web/src/auth/LoginScreen.tsx` renders a password field; `401` → an error message, `429` → a lockout message.
- [ ] `App.tsx` gates the shell: `checking` → a spinner, `unauthenticated` → `<LoginScreen/>`, `authenticated` → the existing layout; a logout control joins the sidebar header.
- [ ] `npm run typecheck` and `npm test` pass.
