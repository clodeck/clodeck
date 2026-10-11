# Handoff — clodeck (the production build)

**Updated:** 2026-10-11
**Effort spec:** [spec-05-auth.md](spec-05-auth.md) — **built, tested, code-reviewed; tickets 23–26 resolved.**
That was the last MVP slice that was planned. The remaining wayfinder slice is **08 (Docker/compose/Caddy)**,
still **unticketed**.
`main` is at **`febf53e`** — the auth slice is `e7b1f46`, and `febf53e` is the dev-loop port fix that followed it
(both below the handoff commit). Nothing is pushed: **`origin` is two commits behind `main`.**
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Read this first: the dev loop needs `PORT=3300` on this machine

Port **3001 is unbindable here** — Windows gave `2980–3079` to Hyper-V/WSL as a dynamic exclusion range, and the
OS refuses every bind inside it with `EACCES`. The server dies at startup, its log stays empty, and every request
through the client is a **502 that looks like a bug in whatever was last built** (that is exactly how the auth
slice got blamed for one). Before running anything by hand:

```cmd
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:\work\clodeck-projects
set PORT=3300
npm run dev
```

The Vite proxy follows `PORT` (`web/vite.config.ts`), so the client on `localhost:5173` reaches the server on
3300. If Vite says "Port 5173 is in use", read its log for the port it took instead (5174) — a second dev loop
shifts it silently. The alternative is an elevated `net stop winnat && net start winnat` (releases the ranges
until the next reboot), and the whole failure mode is written up in the README under "When the dev server
answers 502".

## Where this stands

Four slices are **built, tested and reviewed**. `main` is the repo's only branch.

| # | Ticket | Status |
|---|--------|--------|
| 01–05 | monorepo, shared types, `GET /api/projects`, web shell | resolved (see [spec.md](spec.md)) |
| 06–14 | SDK pin/facade, WS bus, history/resume, terminal (server + web) | resolved |
| 15–20 | file viewer: `FileEntry`, `ScopedFs`, six REST routes, `useFiles` + drawer | resolved |
| 21 | [Tree view with inline folder expansion](issues/21-tree-view-inline-expansion.md) | resolved |
| 22 | [Editable toggle + save](issues/22-editable-toggle-save.md) | resolved |
| 23 | [Auth foundations — Principal, scrypt, session store](issues/23-auth-foundations.md) | resolved |
| 24 | [Auth transport — login/logout/me, gate, rate-limit, origin](issues/24-auth-transport.md) | resolved |
| 25 | [Install the gate — buildApp, config/main, re-green](issues/25-install-auth-gate.md) | resolved |
| 26 | [Web login screen + auth client](issues/26-web-login-screen.md) | resolved |

The path is now real end to end **and closed**: `PROJECTS_ROOT` → allowlist → project switcher → a project's
Agent SDK session streaming over `/ws` (tool cards, approvals, history, resume), its own raw-byte shell over
`/ws/terminal` in an xterm.js panel, its files browsed and mutated through `/api/projects/:id/files` in the
drawer — all of it behind one password. `UI_PASSWORD` unset → fail-closed (401 everywhere, login impossible).

## What the next session is for

1. **Drive the browser by hand** — still the one thing no test covers, and now three surfaces deep: the xterm
   panel (tickets 14/20's gap), the file drawer (tree expand/collapse, active-folder create/upload, the
   read-only ⇄ writable toggle and save — tickets 21–22), and **the new login screen → shell → logout** (ticket
   26). `UI_PASSWORD=dev PROJECTS_ROOT=D:\work\clodeck-projects npm run dev`, then <http://localhost:5173>.
2. **Docker image / compose / Caddy** (wayfinder 08) — the last wayfinder slice, **unticketed**. `GET /healthz`
   is there for it, `/healthz` is auth-exempt on purpose, and the README's auth section is the deployment
   contract (HTTPS termination, `UI_PASSWORD_FILE` as the Docker-secret shape). Note node-pty is a native
   binding: the image needs a glibc base (the `node:22-bookworm-slim` plan) and a working shell in the container.
3. Out of MVP, per `AGENTS.md`: git explorer, plugins, browser-use, markdown preview, a UI model picker.

## Facts that live nowhere else

**Slice 01–02 (still true)**

- **The mirror pin is load-bearing and subtle.** `server/src/sdk/mirror.ts` is the only place the real SDK union
  meets the hand-written mirror in `shared/src/sdk.ts`. Its `case` arms *are* the pin; the three named `system`
  arms assign to an **annotated** target on purpose. `import type` only — no runtime SDK dependency, which is
  what keeps the tests fast and offline. **Exactly one mirror field has ever needed widening**:
  `UserApiMessage.role` gained `'system'`. Widen the mirror; never redesign the envelope.
- **`shared/src/protocol.ts` is frozen.** No ticket has edited it — including the auth slice, which rides REST +
  cookies + a rejected WS *handshake*, so nothing about it appears in the envelope. A change that seems to need
  one is a signal to re-read the ticket.
- **`SdkProvider`** (`server/src/sdk/provider.ts`, no SDK import) and **`PtySpawner`** (`terminal/pty.ts`) are the
  two injected native facades; `server/src/testing/` holds their scripted fakes and is **excluded from `dist`**.
- **`snapshot.payload.lastSeq` is always `0`** (seq is per-connection). **`resume` only arms a target** — it
  never sends a prompt. Known chat warts are recorded in tickets 10/11 rather than hidden; the chat React layer
  has **no rendered test**.

**Slice 03 (the terminal)**

- **`/ws/terminal` is raw bytes out of one module** (`terminal/transport.ts`), and the **`owners` map is what
  makes a reload safe** — only the current owner may write to or close a project's shell. `@fastify/websocket` is
  registered exactly once, in `buildApp`. Resize is REST (`POST /api/projects/:id/terminal/size`) and the attach
  addon never sends a size, so `@xterm/addon-fit` is load-bearing.

**Slice 04 (the file drawer) + 21–22 (tree + editable)**

- **Two files carry it**: `server/src/files/scoped-fs.ts` (both brands, every fs call) and
  `server/src/files/transport.ts` (all six routes). There is **no new injected seam** — `fs` is not a native
  binding, so the reader is tested against real temp directories.
- **The fence is compile-time, the boundary is runtime**: `ScopedPath`/`FileName` are minted only by
  `resolve()`/`name()`, but the brand evaporates at `tsc`'s exit, so every route re-validates through `realpath`
  containment. `relPath` is the single syntax check fronting **all** routes, read and write alike.
- **Upload is create-only (`wx`); save is the one deliberate overwrite** and refuses a symlink, a non-file and a
  missing target. `protocol.ts` and `shared/src/files.ts` were never touched.
- **The web drawer is `web/src/files/`** (`reducer.ts` pinned unions, `transport.ts`, `useFiles.ts`,
  `FilePanel.tsx`). Content renders only as React text nodes — no `innerHTML` anywhere — enforced by grep-able
  rules.

**Slice 05 (auth) — the new ones**

- **The gate is a *scope*, and that is the whole design.** `server/src/auth/transport.ts` exports
  `registerAuthRoutes` (login + logout, installs **no** hook), `registerAuthMeRoute` (for the gated side), and
  the hook factories. `buildApp` registers `/api` → `registerAuthRoutes`, then a **nested scope** that adds
  `createAuthGate` and holds `/projects`, sessions, terminal-size, files and `/auth/me`.
- **Why nested and not "the hook in the middle":** Fastify resolves a scope's `onRequest` hooks at
  `avvio.once('preReady')` (`fastify/lib/route.js`), so a hook added *after* `registerAuthRoutes` still gates it
  — one flat scope with the hook between the two route groups would gate login and logout too. Verified against
  fastify 5.12.5. Do not "simplify" the nesting away.
- **Both WebSocket routes are fronted by `installWebSocketGuards(scope, auth)`** — origin guard, then the cookie
  gate. `@fastify/websocket` dispatches the upgrade through the normal Fastify router
  (`fastify.routing(rawRequest, rawResponse)`), so an `onRequest` hook that replies **refuses the handshake
  before a socket exists**; the client sees `Unexpected server response: 401` (or `403`).
- **The origin check compares `Origin`'s host to `Host` and nothing else** — scheme is not compared (proxies
  terminate TLS here) but the **port is** (a same-host/different-port origin is refused). No `Origin` → pass
  (curl, tests). It is a second hook, not a flag on the gate, and it runs *before* the cookie check.
- **One cookie**: `clodeck_session`, `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`. `Secure` is
  always on (browsers exempt `http://localhost`, so the dev loop still works); there is no off-switch. No signing
  — the value is an opaque `randomBytes(32).toString('base64url')` key into a server-side store, so a logout or a
  restart invalidates it by deletion.
- **`@fastify/cookie` is registered at the app root, before the gate** (fastify-plugin breaks encapsulation, so
  its parse hook is on the root scope and runs before a child scope's hooks) — that is why
  `request.cookies` is populated inside the gated scope.
- **`AuthOptions` is `{ verifyPassword, sessions, loginLimit?, warn? }` on `buildApp`** — the fourth injected
  seam. `verifyPassword` is injected as a *function* so no suite but `password.test.ts` ever runs scrypt
  (deliberately slow), and `sessions` as an interface because that is the Redis/DB swap point.
- **`createAuthOptions(uiPassword, warn)`** (`server/src/auth/options.ts`) is the production seam both entry
  points use. **`UI_PASSWORD` → `UI_PASSWORD_FILE` (trimmed) → `null`**, and `null` builds
  `verifyPassword: () => false` plus a loud warning: the server boots, the gate is installed, nothing gets in.
  `dev:fake` is gated the same way — an open dev loop would be a rehearsal, not the loop.
- **The login limiter is per-`request.ip`**, five failures in 15 min lock the address for 15 min (`429` even for
  the right password — the check runs *before* `verifyPassword`, so a lockout also costs no scrypt). A success
  clears the run; a served lock or a stale window is dropped on the next check. No sweeper.
- **The web half is `web/src/auth/`**: `transport.ts` (`login` → a `{ ok } | { ok: false, reason: 'invalid' |
  'locked' | 'failed' }` union, `fetchMe` → `Principal | null`, `logout`), `useAuth.ts` (the trio
  `checking | authenticated | unauthenticated`), `LoginScreen.tsx`. **`App` is the gate and `Shell` is the old
  layout**: `useProjects` moved into `Shell` because a hook cannot sit behind an early return, so no panel mounts
  and no socket opens before login. After a successful login the principal is re-read from `/me` (the login
  response is `{ ok: true }` and nothing more).
- **`test-support.ts` owns the suite's auth**: `TEST_PASSWORD`, `createTestAuth()` (trivial verifier + a real
  store + a silent warn), and `login(app)` → the `cookie` header value. The socket suites have `makeApp()`
  return the cookie (a handshake cannot use `inject`); the two big route suites use a local
  `authed(app, options)` wrapper. **There is no bypass** — every suite goes through the real login route.
- **The slice was reviewed on both axes and the findings adjudicated** (each ticket's `## Code review` section
  carries the detail). Fixed: the `useAuth` return shape (the spec pins `{ status, principal, login, logout }`,
  flat), a `logout` that rejected through `void onLogout()`, the refusal union and the scrypt-params shape each
  declared twice+. Declined **with reasons**: pulling the login limiter out of `transport.ts` (spec pins it
  there), a shared `failureMessage` across the three web transports, and `Principal` being carried to a client
  that does not read it yet (it is the pinned seam). One spec *intent* gap is recorded rather than fixed: the
  store slides but the cookie does not, so a session lapses 7 days after login regardless of activity.

## Environment notes (still true, one addition)

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`. There is no
  `docs/agents/issue-tracker.md`; `AGENTS.md` carries the convention, and there is **no `map.md`** for this
  effort — this file is the map. No `gh` CLI: work closes by marking a ticket `Status: resolved` and committing
  `close ticket NN: …`.
- **`UI_PASSWORD` is now required for any real boot**, `dev` and `dev:fake` alike: without it the server boots
  fail-closed and prints the warning. Locally: `set UI_PASSWORD=dev && set PROJECTS_ROOT=D:\work\clodeck-projects
  && npm run dev` (cmd). The test root `D:\work\clodeck-projects` still holds `hello/` and `demo/`.
- **Port 3001 is OS-blocked on this machine — run the dev loop on another port.** Windows/Hyper-V/WSL reserve
  dynamic ranges at boot (`netsh interface ipv4 show excludedportrange protocol=tcp` → `2980–3079` here, which
  contains 3001) and every bind inside them is `EACCES`. The symptom is a **502 from Vite with nothing in the
  server's log** — because the server never started. So: `PORT=3300 npm run dev`; the Vite proxy now follows
  `PORT` (`web/vite.config.ts`, pinned by `web/vite.config.test.ts`). Or reclaim the ranges for the boot with an
  elevated `net stop winnat && net start winnat`. **Not a code bug, and not caused by the auth slice.**
- Vite binds `localhost` → `[::1]:5173` on Windows (probe `localhost`, never `127.0.0.1`; with a second dev loop
  running it silently takes 5174 — read its log for the port); the backend binds `127.0.0.1:3001` by default,
  which is what the proxy targets. `/ws` is proxied with `ws: true`, so `/ws/terminal` rides the same prefix.
  **`npm run dev` passes `--raw` to `concurrently` on purpose** — restoring the `-n server,web` prefixes
  re-breaks the real SDK's import under `tsx watch` (see README).
- **The root `npm run dev` works**, verified by hand on 2026-10-11: it boots the real `main.ts` (SDK imported,
  not the fake) *and* Vite, and `/api/auth/login` through the proxy answers 200 + the session cookie. `main.ts`'s
  top-level `await createAuthOptions(...)` is not a boot hazard.
- An empty `PORT=` counts as unset in both entry points (`Number('')` is 0 — a random port — while the proxy
  would point at 3001: the same silent-502 class).
- Worktrees are cheap but `D:/work/clodeck-wt/<name>` (outside the repo, since `.claude/worktrees/` is not
  gitignored); every one needs its own `npm install`. npm 11 does not run install scripts by default; node-pty
  ships prebuilds so it loads anyway.
- Four tests are `it.skipIf(win32)` — all symlink guards (a junction cannot express a file symlink).

## Resume

```
READ FIRST: the dev loop must run on a port outside Windows' excluded ranges - use `PORT=3300`, or the server
never starts and the client just 502s with an empty server log (see "Read this first" above).

Auth (spec-05, tickets 23-26) is COMPLETE: reviewed, committed to `main` (`e7b1f46`), tested. The whole MVP
surface is built and gated - chat over the Agent SDK, per-project shell, file drawer, and a single-password
login in front of all of it. `main` is the repo's only branch, and `main` is at `febf53e` (the dev-loop port
fix). NOTHING IS PUSHED: `origin` is two commits behind.

Done:
  - 23 shared Principal + server/src/auth/password.ts (scrypt, timing-safe) + sessions.ts (sliding 7-day store)
  - 24 server/src/auth/transport.ts (login/logout/me, cookie, the reusable gate + origin guard, per-IP limiter)
  - 25 the install: buildApp({auth}) with the nested gated scope, @fastify/cookie, config.uiPassword,
       auth/options.ts, main.ts + dev-fake.ts, test-support login/createTestAuth, all suites migrated
  - 26 web/src/auth/ (transport, useAuth, LoginScreen) + App-as-gate with a logout control
  - dev-loop fix after the slice: web/vite.config.ts follows PORT (+ vite.config.test.ts), empty PORT counts
    as unset, README documents the EACCES/502 failure mode
  Verified: typecheck + build clean; server 221 passed / 7 skipped, web 87 passed. By hand with the REAL
  `npm run dev` on PORT=3300 (SDK imported, not the fake): anonymous /api/projects 401, wrong password 401,
  correct password 200 + clodeck_session, gated route 200, /healthz 200 - through the Vite proxy. Also by hand
  on dev:fake: cross-origin WS 403, logout kills the session, UI_PASSWORD unset -> fail-closed with a warning.

Next:
  1. Push `main` (two commits: e7b1f46, febf53e) - nothing has left this machine.
  2. Drive the browser by hand - the login screen, then the xterm panel and the file drawer. The browser half
     of tickets 14, 20-22 and 26 has NEVER been seen by a human; ticket 26 is the newest and least verified.
     UI_PASSWORD=dev PROJECTS_ROOT=D:\work\clodeck-projects PORT=3300 npm run dev, then http://localhost:5173.
  3. Docker/compose/Caddy (wayfinder 08) - unticketed, the last slice on the wayfinder map. It is the slice
     that makes the deploy story real: HTTPS termination (the cookie is Secure), UI_PASSWORD_FILE as the
     secret shape, /healthz as the healthcheck, node-pty needing a glibc base.
```
