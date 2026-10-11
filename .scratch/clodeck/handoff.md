# Handoff — clodeck (the production build)

**Updated:** 2026-10-11
**Effort spec:** [spec-06-docker.md](spec-06-docker.md) — **implemented**: tickets 27–30 are resolved, reviewed
on both axes, and committed (`23ca37c`, `838b2f6`, `6e9bbc0`). Before them, the last built slice was auth
(spec-05, 23–26). **Every ticket in `.scratch/clodeck/issues/` is now resolved — the effort has no open work
left.** As of 2026-10-11 23:30 the working tree is clean and `main` is **level with `origin/main`** at
`6e9bbc0` (this environment pushes after a commit; the agent session never ran `git push`).
**This file:** the session-to-session layer for the build. Overwrite each time; git history keeps the old ones.

## Read this first: the dev loop needs `PORT=3300` on this machine

Port **3001 is unbindable here** — Windows gave `2980–3079` to Hyper-V/WSL as a dynamic exclusion range, and
the OS refuses every bind inside it with `EACCES`. The server dies at startup, its log stays empty, and every
request through the client is a **502 that looks like a bug in whatever was last built**. Before running
anything by hand:

```cmd
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:\work\clodeck-projects
set PORT=3300
npm run dev
```

The Vite proxy follows `PORT` (`web/vite.config.ts`), so the client on `localhost:5173` reaches the server on
3300. If Vite says "Port 5173 is in use", read its log for the port it took instead (5174). The alternative
is an elevated `net stop winnat && net start winnat`. The whole failure mode is written up in the README
under "When the dev server answers 502". **Docker's port publishing hits the same wall**: `-p 3300:3001`
fails with "an attempt was made to access a socket in a way forbidden by its access permissions" — publish
on a high port (`18080`) instead, and pass `MSYS_NO_PATHCONV=1` or Git Bash rewrites `-e PROJECTS_ROOT=/projects`
into `C:/Program Files/Git/projects`.

## Where this stands

| # | Ticket | Status |
|---|--------|--------|
| 01–05 | monorepo, shared types, `GET /api/projects`, web shell | resolved (see [spec.md](spec.md)) |
| 06–14 | SDK pin/facade, WS bus, history/resume, terminal (server + web) | resolved |
| 15–22 | file drawer: `ScopedFs`, six REST routes, `useFiles`, tree, editable toggle | resolved |
| 23–26 | auth: Principal/scrypt/session store, transport + gate, install, login screen | resolved |
| 27 | [Serve the built SPA](issues/27-serve-built-spa.md) — `WEB_ROOT`, `@fastify/static`, SPA fallback | resolved |
| 28 | [Dockerfile](issues/28-dockerfile.md) — builder → deps → runtime, non-root, glibc | resolved |
| 29 | [compose + Caddy](issues/29-docker-compose-caddy.md) — TLS, volumes, secret, healthchecks | resolved |
| 30 | [Deploy docs + end-to-end verification](issues/30-deploy-docs-verification.md) | resolved |

`docker compose up -d` brings the whole product up behind Caddy; `docker run` of the same image serves the
login screen on its own. The dev loop is deliberately unchanged: `WEB_ROOT` unset → no static route → Vite
serves the client.

## What the next session is for

**1. Drive the browser by hand.** It is the only part of the MVP no run has ever covered — every slice is
tested at the HTTP/WS boundary, and the React layer has no rendered test at all. Two loops, in this order:

```cmd
rem the dev loop (Vite 5173 + server 3300)
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:\work\clodeck-projects
set PORT=3300
npm run dev
rem -> http://localhost:5173   (use dev:fake instead if there is no API key)

rem later, the production shape: no Vite at all
npm run build
set WEB_ROOT=..\web\dist
npm start --workspace @clodeck/server
rem -> http://127.0.0.1:3300
```

The checklist, none of which has been seen by a human:

1. **Login** — the screen appears with no session; a wrong password says so; five failures say "locked"
   (the per-IP limiter); the right one lands in the shell. Then **log out** and land back on the screen.
2. **Project switcher** — `demo` and `hello` are listed from `PROJECTS_ROOT`; drop a new directory in and
   press refresh; it appears.
3. **Chat** — send a prompt; text streams in; a tool card and the approval modal come up (`dev:fake`
   scripts exactly one turn, so a real key is needed for anything longer); reload the page and **resume** a
   session from history.
4. **Terminal** — the panel opens a shell in the project directory, typing works, and dragging the panel
   edge resizes the pty (this is what `@xterm/addon-fit` and the REST resize route exist for). Reload: the
   new connection takes over the shell.
5. **File drawer** — expand a nested folder, create a file and a folder, rename, delete, upload, then the
   editable toggle and save (save is the one route that overwrites on purpose).
6. **The gate holds in a browser** — after logging out, the shell's next call is a 401, and `/ws` refuses.

**2. A real public deploy has never happened.** The Let's Encrypt branch of ticket 29 was verified only with
Caddy's *internal* CA (`CLODECK_DOMAIN=localhost`), because this machine has no public domain. Everything
else in the compose path was exercised for real, including the `wss://` handshake through the proxy.

**3. Out of MVP**, per `AGENTS.md`: git explorer, plugins, browser-use, markdown preview, a UI model picker.
There is no open ticket and no spec for any of them — the next slice starts with a new spec.

## Facts that live nowhere else

**Slices 01–05 (still true, compressed)**

- **The mirror pin is load-bearing**: `server/src/sdk/mirror.ts` is the only place the real SDK union meets
  the hand-written mirror in `shared/src/sdk.ts`; its `case` arms *are* the pin. `import type` only — no
  runtime SDK dependency. Exactly one mirror field has ever needed widening (`UserApiMessage.role` gained
  `'system'`). Widen the mirror; never redesign the envelope.
- **`shared/src/protocol.ts` is frozen** — no ticket has edited it, including the deploy slice.
- **`SdkProvider`** and **`PtySpawner`** are the two injected native facades; `server/src/testing/` holds
  their scripted fakes and is excluded from `dist`. `AppOptions` now carries **five** fields — `projects`,
  `provider`, `spawner`, `auth` (the four seams) and `webRoot` (configuration, not a seam: a path with
  nothing behind it to fake).
- **`snapshot.payload.lastSeq` is always `0`** (seq is per-connection); **`resume` only arms a target**.
  The chat React layer has **no rendered test**.
- **`/ws/terminal` is raw bytes** out of one module, and the `owners` map is what makes a reload safe.
  Resize is REST; `@xterm/addon-fit` is load-bearing. `@fastify/websocket` is registered exactly once.
- **Two files carry the file drawer**: `files/scoped-fs.ts` (both brands, every fs call) and
  `files/transport.ts` (all six routes). `relPath` is the single syntax check fronting all of them; upload
  is create-only (`wx`), save is the one deliberate overwrite. `protocol.ts` and `shared/src/files.ts` were
  never touched.
- **The auth gate is a *scope*, not a hook in the middle** (`app.ts`): `/api` registers login/logout, then a
  **nested** scope adds `createAuthGate` and holds everything else. Fastify resolves a scope's hooks at
  `preReady`, so a flat scope would gate login too. Do not "simplify" the nesting away. Both WS routes are
  fronted by `installWebSocketGuards` (origin first, then the cookie), which refuses the *handshake*.
- **`AuthOptions` is `{ verifyPassword, sessions, loginLimit?, warn? }`**; `createAuthOptions(uiPassword)`
  is the production seam both entry points use; `UI_PASSWORD` → `UI_PASSWORD_FILE` → `null` fail-closed.
  `test-support.ts` owns the suite's auth (`TEST_PASSWORD`, `createTestAuth()`, `login(app)`), and **there
  is no bypass** — every suite logs in through the real route.
- The login limiter is per-`request.ip`, five failures in 15 min; the check runs *before* `verifyPassword`.
  One cookie, `clodeck_session`, `HttpOnly; Secure; SameSite=Strict`, `Max-Age=604800`, server-side store.

**Slice 06 (the deploy slice) — the new ones**

- **`WEB_ROOT` unset is the dev loop; set is production.** `registerStaticClient(app, webRoot)` registers
  `@fastify/static` on the **root** scope (auth-exempt — the bundle is public, the data is gated) plus a root
  `setNotFoundHandler`. The SPA fallback answers `index.html` for a non-file GET that accepts html **and is
  not under `/api` or `/ws`** — those namespaces are the server's, so a path under them that matches no
  route is a real 404. Without that guard the wildcard answers `/api/typo` with the app shell (the review
  caught it; `static.test.ts` pins it).
- **node-pty has no Linux prebuild.** `node-pty@1.1.0`'s tarball ships `prebuilds/{darwin-arm64,darwin-x64,
  win32-*}`, so on Linux its install script falls through to `node-gyp rebuild`. That is why the Dockerfile
  has **three** stages: `builder` (node:22 full, `npm ci` + `npm run build`), **`deps`** (node:22 full,
  `npm ci --omit=dev --workspace @clodeck/server` — the workspace filter is what keeps web's React/xterm
  deps out), and `runtime` (bookworm-slim, which `COPY --from=deps /app/node_modules`). Wayfinder 08 §2 and
  spec-06 both assume the prebuild loads; they are wrong for Linux.
- **`test-support.ts` gained `createTestApp()`** (the standard fakes + the real gate + `webRoot: null`, with
  `Partial<AppOptions>` overrides) and the shared `listen()`/`handshake()` the socket suites had each been
  copying. A new suite should start from `createTestApp`; only `static.test.ts` passes `webRoot`.
- **compose requires its variables (`${VAR:?}`), for every subcommand** — `docker compose ps` fails without
  `CLODECK_DOMAIN`, `PROJECTS_ROOT` and `ANTHROPIC_API_KEY`, which is the price of never booting an app with
  an empty projects root. `.env` next to the compose file pays it; `secrets/ui_password.txt` is gitignored
  and mounted at `/run/secrets/ui_password`. The app service publishes **no** ports; Caddy's 80/443 are the
  only way in, and Caddy's own upstream health is `/healthz` (`health_uri`) while its container healthcheck
  probes the admin API on `:2019` (a plain-HTTP probe on :80 only sees the HTTPS redirect).
- **By-hand HTTPS against Caddy with curl is unreliable on this machine** (Git Bash's schannel curl reports
  `http_code=000` — "remote party requests renegotiation" — while the request actually succeeds). Use node
  `fetch` with `NODE_TLS_REJECT_UNAUTHORIZED=0` for HTTPS checks, and node's `ws` for a `wss://` handshake.
  Both scripts are throwaway; the runs are recorded in tickets 29/30.

## Environment notes (still true, two additions)

- Tracker = local markdown, one file per ticket, numbered from `01`, under `.scratch/clodeck/`. There is no
  `docs/agents/issue-tracker.md` and **no `map.md`** — this file is the map. No `gh` CLI: work closes by
  marking a ticket `Status: resolved`, appending `## What landed` / `## Decisions` / `## Code review` /
  `## Evidence`, and committing.
- **`UI_PASSWORD` is required for any real boot**, `dev` and `dev:fake` alike. The test root
  `D:\work\clodeck-projects` holds `hello/` and `demo/`.
- **Port 3001 is OS-blocked** (see "Read this first"), and so is Docker publishing on some low ports.
- Vite binds `localhost` → `[::1]:5173` on Windows (probe `localhost`, never `127.0.0.1`). `npm run dev`
  passes `--raw` to `concurrently` on purpose — restoring `-n server,web` re-breaks the real SDK's import
  under `tsx watch`.
- **Docker Desktop must be running** (`docker info` fails with a npipe error otherwise; launch
  `"C:\Program Files\Docker\Docker\Docker Desktop.exe"` and give it a minute). The built image is
  `clodeck-app:latest` (874 MB) and the compose volumes (`clodeck_claude-data`, `clodeck_caddy-*`) survive
  `docker compose down` — bring the stack up with `CLODECK_DOMAIN=localhost ANTHROPIC_API_KEY=dummy
  PROJECTS_ROOT='D:/work/clodeck-projects' MSYS_NO_PATHCONV=1 docker compose up -d`.
- npm 11 prints an advisory "install scripts not yet covered by allowScripts" warning; it does **not**
  block them, which is why node-pty compiles inside the image build. npm 11 also has no
  `install-scripts` approval configured in this repo — nothing to review.
- Worktrees are cheap but `D:/work/clodeck-wt/<name>` (outside the repo); every one needs its own
  `npm install`. Four tests are `it.skipIf(win32)` — all symlink guards.

## Resume

```
READ FIRST: the dev loop must run outside Windows' excluded ranges - use PORT=3300, and Docker must
publish on a high port with MSYS_NO_PATHCONV=1 (see "Read this first").

ALL TICKETS ARE RESOLVED. The deploy slice (spec-06, tickets 27-30) is built, verified by build+run,
reviewed on both axes (findings fixed: the SPA fallback no longer answers for /api and /ws, the README no
longer contradicts compose about ANTHROPIC_API_KEY, and the suites' duplicated listen/handshake/buildApp
boilerplate collapsed into test-support.ts), committed, and pushed - the tree is clean and main is level
with origin/main at 6e9bbc0.

Next (nothing is in flight; the tracker has no open ticket):
  1. Drive the browser by hand - the checklist is in "What the next session is for" above. No human has
     ever seen this UI: login -> shell -> logout, the switcher, chat (+ resume), the xterm panel, the file
     drawer's tree/editable/upload/delete. `PORT=3300 npm run dev`, then http://localhost:5173.
  2. Then the production shape: `npm run build` + `WEB_ROOT=..\web\dist npm start --workspace @clodeck/server`
     -> http://127.0.0.1:3300 (the server serves the SPA; no Vite).
  3. A real deploy is the other open verification (no public domain here, so the Let's Encrypt path has
     never run). After that, the next slice needs a new spec - the out-of-scope list in AGENTS.md is the
     menu.
```
