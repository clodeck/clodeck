# 27: Serve the built SPA from the server

**What to build:** The server serves the built web client, so `npm run build && npm start` is a single deployable artifact with no Vite. `@fastify/static` serves `WEB_ROOT` at `/`, auth-exempt, with an SPA fallback to `index.html`; an unset `WEB_ROOT` changes nothing (the dev loop keeps serving the client itself). `/healthz`, `/api/**`, `/ws`, and `/ws/terminal` must still win over the static catch-all.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `server/package.json` gains `@fastify/static`; registered on `buildApp` at the root, auth-exempt (never inside the gated `/api` scope).
- [x] `AppOptions` gains `webRoot: string | null`; `null` registers no static route (today's behavior). The "fourth and last injected seam" comment gains one line clarifying `webRoot` is configuration, not a seam.
- [x] `ServerConfig` gains `webRoot`; `loadConfig` reads `WEB_ROOT` (trimmed), unset/blank → `null`. Env-only — no config-file fallback.
- [x] `GET /` and `/assets/**` are served from `webRoot`; a `setNotFoundHandler` on the static scope returns `index.html` for a non-file `Accept: text/html` GET (SPA fallback).
- [x] `/healthz`, `/api/**`, `/ws`, and `/ws/terminal` still take precedence over the static catch-all — no route is shadowed.
- [x] `main.ts` passes `config.webRoot` through `buildApp`. `npm start` stays `node dist/main.js`.
- [x] Tests: `static.test.ts` (builds an app with a temp `webRoot` fixture) asserts `GET /` → 200 `text/html`, an asset path → the file, a deep route → `index.html` (fallback), `/healthz` → 200, `/api/projects` → 401 unauthenticated, an unauthenticated `/ws` upgrade → still refused; `webRoot: null` → `GET /` 404s. `config.test.ts` covers `WEB_ROOT` read / blank → null / unset → null.
- [x] `npm run typecheck`, `npm test`, and `npm run build` pass.

## What landed

```
server/package.json            + @fastify/static (^10.1.6) — the one new server dependency.
server/src/static.ts           registerStaticClient(app, webRoot): the plugin at the root (wildcard `/*`,
                               auth-exempt) + setNotFoundHandler → index.html for a non-file html GET,
                               except under `/api` and `/ws`, which are the server's own namespaces.
server/src/app.ts              AppOptions.webRoot: string | null (required, like the other four);
                               registered last, so every explicit route is already in the router.
server/src/config.ts           ServerConfig.webRoot; WEB_ROOT trimmed and path.resolve'd, blank → null.
                                                                           (no config-file fallback)
server/src/main.ts             passes config.webRoot.  dev-fake.ts: the same, for symmetry.
server/src/test-support.ts     createTestApp() — the standard fakes, the real gate, no bundle — plus the
                               shared listen()/handshake() the socket suites had each been copying.
server/src/static.test.ts      8 tests: index / asset / deep link / missing non-html / healthz + gate
                               (401 anonymous, 200 signed in) / an unregistered `/api`+`/ws` path
                               (404, not the shell) / the /ws refusal / webRoot: null.
server/src/app.test.ts         the WEB_ROOT config case joins the existing loadConfig block — there is
                               no `config.test.ts` in this repo; config is tested here.
server/src/*/*.test.ts         the six other suites build through `createTestApp` instead of spelling the
                               four fakes out; only this suite sets `webRoot` to anything.
```

## Decisions the spec did not pin

- **`webRoot` is required, not defaulted.** Every other `buildApp` option is stated at every construction
  site, and `webRoot: null` is a real statement ("this server serves no client") rather than an absence.
  The cost is one line in six suites; the comment on `AuthOptions` now says why it is not a fifth seam.
- **The fallback is a root `setNotFoundHandler`, and it is installed only when `webRoot` is set.** Fastify
  hands a missing file to `reply.callNotFound()` (`@fastify/static`'s wildcard route does exactly that), so
  the 404 handler is the natural seam. Gating it on `webRoot` is what keeps every other suite's 404s —
  Fastify's default JSON — exactly as they were.
- **A non-html 404 keeps `{ error: 'not found' }`** rather than Fastify's default envelope: the app's own
  error shape, and `fetch` sends no `text/html`, so an API client never receives a page it cannot parse.
- **The wildcard wins by router precedence, not registration order.** find-my-way prefers a static path
  over `/*`, which is why `/healthz`, `/api/**` and both sockets still route to their own handlers; the
  suite pins all four rather than trusting the plugin's docs.

## Evidence

```
npm run typecheck                      → clean (shared → server → web)
npm test                               → 230 passed | 7 skipped (server, 19 files) · 87 passed (web)
npm run build                          → clean
npx vitest run src/static.test.ts      → 8 passed
```

By hand, against the built artifact (`UI_PASSWORD=dev PROJECTS_ROOT=D:\work\clodeck-projects PORT=3300
WEB_ROOT=../web/dist node dist/main.js`):

```
GET /healthz                    → 200
GET /                           → 200 text/html; charset=utf-8, <title>Clodeck</title>
GET /projects/alpha/sessions    → 200 text/html (the SPA fallback), Accept: text/html
GET /assets/index-CQ22_7eu.js   → 200 application/javascript; charset=utf-8
GET /api/projects               → 401 unauthenticated
POST /api/auth/login {dev}      → 200, session cookie
GET /api/auth/me (cookie)       → 200 {"principal":{"id":"default","name":"default"}}
GET /api/projects (cookie)      → 200 {"projects":[…]}
GET /nope.txt                   → 404
```

Story 14 — "the bundle public, the data gated" — is observable for the first time: the login screen loads
with no session, and the same origin refuses every data route without one.

## Code review

Two-axis review of the whole slice (`git diff 32ed23b...HEAD`; Standards: repo conventions + the Fowler
smell baseline; Spec: `spec-06-docker.md` + tickets 27–30). What follows is this ticket's share.

- **Fixed — spec gap**: the fallback answered for the *server's* namespaces too. `GET /api/typo` (or
  `/ws/typo`) with an html `Accept` reached the root `setNotFoundHandler` and came back as the app shell,
  where the spec says "`/api/**` … must still win over the static catch-all — no route is shadowed". The
  wildcard's `callNotFound` cannot tell a client route from a mistyped API path, so the handler now checks:
  `/api` and `/ws` are the server's, and a path under them that matches no route is a real 404 — which is
  exactly what an unauthenticated caller saw before this slice. `static.test.ts` pins it.
- **Fixed — Duplicated Code** (Standards, the strongest finding): this ticket's suite re-declared
  `listen` and `handshake` — byte-identical to copies already in `app.test.ts`, `terminal/transport.test.ts`
  and `ws/bus.test.ts` — and stated the same five-line `buildApp` block in seven files to say `webRoot: null`.
  Both are now `test-support.ts`: `listen`, `handshake`, and a `createTestApp(overrides)` factory that owns
  "the standard fakes, the real gate, no bundle". Every suite now names only the options it is *about*.
- **Declined, with the reason the finding itself supplied — Shotgun Surgery**: `webRoot` is required, so
  adding it touched six suites. The reviewer noted it is a documented decision; with `createTestApp` the
  cost is now one line in one file, which is the same reason making the field optional would have been
  wrong — the factory states "no client" out loud instead of hiding it in a default.
- **Noted — the checklist names a file that does not exist**: ticket 27 says the config test "extends
  `config.test.ts`", but this repo has no such file — `loadConfig` has always been tested in `app.test.ts`.
  The `WEB_ROOT` case joined it there rather than inventing a file to match the ticket's wording.

## Spec deviations kept, and why

- **The wildcard is trusted for precedence rather than re-implementing routing.** The spec says the
  explicit routes "are registered first" and must win; they do, but by find-my-way's static-over-wildcard
  rule, not by order. The suite asserts all four (`/healthz`, `/api/projects`, `/ws`, `/ws/terminal`)
  against a real router instead of relying on the plugin's documentation.

