# 26: Web login screen + auth client

**What to build:** The browser login experience. A `useAuth` seam (mirroring `useProjects`) owns auth state; a `LoginScreen` collects the password; `App.tsx` gates the whole shell so no panel mounts and no socket opens before login. The cookie rides the same-origin `/ws` and `/ws/terminal` upgrades automatically, so the socket code needs no change.

**Blocked by:** 25

**Status:** resolved

- [x] `web/src/auth/transport.ts` exposes `login(password)`, `logout()`, and `fetchMe()` — a fetch layer with no React, testable under the node environment like `files/transport.ts`.
- [x] `web/src/auth/useAuth.ts` exposes `{ status: 'checking' | 'authenticated' | 'unauthenticated', principal, login, logout }`, booting from `GET /api/auth/me`.
- [x] `web/src/auth/LoginScreen.tsx` renders a password field; `401` → an error message, `429` → a lockout message.
- [x] `App.tsx` gates the shell: `checking` → a spinner, `unauthenticated` → `<LoginScreen/>`, `authenticated` → the existing layout; a logout control joins the sidebar header.
- [x] `npm run typecheck` and `npm test` pass.

## What landed

```
web/src/auth/transport.ts        login → LoginResult ({ok} | {ok:false, reason:'invalid'|'locked'|'failed'}),
                                 fetchMe → Principal | null, logout → void; failureMessage + isPrincipalEnvelope.
web/src/auth/useAuth.ts          AuthState, AuthQuery, useAuth().
web/src/auth/LoginScreen.tsx     the form: password field, in-flight state, 401 vs 429 messaging.
web/src/App.tsx                  App = the gate; Shell (the old layout + `useProjects`) mounts only when
                                 authenticated; a Log out button in the sidebar header; CheckingSession.
web/src/auth/transport.test.ts   9 tests — the three URLs/methods/bodies, 401→invalid, 429→locked,
                                 other/network→failed, /me → principal | null | throws, logout ok/throws.
```

## Decisions the spec did not pin

- **`login` returns a discriminated result instead of throwing.** The one caller is a form, and three refusals
  read differently ("wrong password" is the user's to fix, a lockout is time, anything else is the server's) —
  the same union-of-arms style the file drawer's reducer uses. Only `fetchMe`/`logout` throw, and only on a
  status the UI cannot act on.
- **After a successful login the principal is re-read from `GET /api/auth/me`**, because the login response is
  `{ ok: true }` and nothing more. One extra same-origin round trip keeps the client's idea of who it is derived
  from the server rather than a hard-coded constant in the bundle.
- **`useAuth` has no `error` arm** — the spec pins the trio, and a `/me` that cannot be interpreted *is* "no
  session we can act on": the login form is the recovery path either way. `useAuth` therefore catches a failed
  boot check and lands on `unauthenticated`.
- **`logout` always ends on `unauthenticated`, even if the request failed.** The server is the authority on
  whether the cookie is still a session, and the next gated call is what finds out; leaving the user on a shell
  they asked to leave would be the worse lie.
- **The gate is a mount boundary, not a router.** `useProjects` moved from `App` into a new `Shell` component,
  because a hook cannot be called behind an early return — so "no panel mounts before login" is enforced by
  where the component is mounted, and `/api/projects` is not fetched until there is a session.
- **The login screen sets no state after a successful login** (the parent has already replaced it), and clears a
  refusal as soon as the user types again.

## Code review

Two-axis review (Standards: repo conventions + the Fowler smell baseline; Spec: `spec-05-auth.md` + tickets
23–26). Three findings on this ticket's files, all actioned:

- **Fixed — spec deviation**: `useAuth` returned `{ state, login, logout }`, nesting `status`/`principal`.
  Spec line 129 and this ticket both pin the flat `{ status, principal, login, logout }`; the hook now returns
  exactly that, and keeps its internal discriminated union private so "authenticated with no principal" still
  cannot be represented.
- **Fixed — unhandled rejection**: `logout` set `unauthenticated` in a `finally` but never caught, so a failed
  `POST /api/auth/logout` rejected through `App`'s `void onLogout()`. It now swallows the failure (the browser is
  done with the shell either way; the server stays the authority on whether the cookie is still a session) — the
  behaviour this ticket's own decision list already claimed.
- **Fixed — Duplicated Code** (Standards): the refusal union was declared in `transport.ts` *and* re-spelled in
  `LoginScreen.tsx`. It is now `LoginRefusal`, exported once and imported by the screen.
- **Declined, recorded — Speculative Generality**: `principal` rides `shared/src/auth.ts` → `fetchMe` →
  `useAuth` and no component reads it. That is the spec's own seam (story 21, and the `useAuth` shape it pins),
  and it is the attach-point multi-user scoping will use; deleting it would be deleting the interface, not
  unearned abstraction.
- **Noted — story 14** ("the SPA bundle public while data endpoints are gated") is vacuous today: the server
  serves no bundle yet (README). The gate's scope is right; the story becomes observable with the Docker/proxy
  slice (wayfinder 08).

## Evidence

```
npm run typecheck                    → clean (shared → server → web)
npx vitest run (web)                 → 84 passed (6 files; auth/transport.test.ts is 9 of them)
npm run build                        → clean
```
Un-verified, as with the terminal and file drawers before it: **nobody has yet seen the login screen in a
browser.** The server half is verified by hand (ticket 25's evidence); the React half is typecheck + build +
the transport tests, since this repo's web suites run in the node environment with no jsdom and no component
renderer.
