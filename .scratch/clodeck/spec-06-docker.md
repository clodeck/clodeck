# Clodeck — Docker image / compose / Caddy slice (the deploy story)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Ta inja hame-ye surface-e MVP sakhte, test, va code-review shode: chat ✓, terminal ✓, file drawer ✓, auth ✓ — amma **hame-ye in faghat rooye `localhost`, be sorat-e dev loop, joda-joda lazem-e Vite shode**. `main.ts` server ro loopback bind mikone, web client ro Vite dev server serve mikone, va hich ja-ye repo nemitone app ro be ye masraf-konande-ye vaghe'i tahvil bede. README khodesh mige: «the server does not serve the built client yet».

Se ghalat inja jam' shode:

1. **Server bundle ro serve nemikone** (story 14-ye auth ta alan "vacuous" ast — ticket 26 ham in ro noted kard). Yani `npm run build && npm start` ye API midhe ke hich UI-i nadare. App ye artifact-e kamel nist.
2. **Hich packaging nadarim** — Dockerfile, docker-compose, `.dockerignore` nist. node-pty (native binding) va binary-e bundled-e SDK har do **glibc**-and, pas base image bayad Debian-slim bashe na Alpine (musl).
3. **TLS nadarim** — cookie `Secure`-e (hamishe on), pas production **hatman** HTTPS mikhād; decision 07 TLS ro gozasht rooye Caddy reverse proxy.

In slice hame-ye in ro mibande: server SPA ro serve mikone (artifact-e tak), Docker image multi-stage, docker-compose ba Caddy sidecar (TLS + reverse proxy), va README deployment contract ro document mikone. Be'd az in, ye operator mitone ba ye `docker compose up` hame-ye product ro be dast biyare — hamin ast «deploy story».

## Solution

**4 tickete**, ba ye tartib-e khati (har kodom artifact-e ghabli ro be-kar migire):

1. **Serve the SPA** (ticket 27) — server `web/dist` ro serve mikone: `@fastify/static` rooye `/`, auth-exempt (public bundle, gated data), SPA fallback be `index.html`. Ba `WEB_ROOT` env var fa'al mishe; unset → hich static route nist (dev loop dast-nakhorde). Ba'd az in, `npm run build && WEB_ROOT=../web/dist npm start` = ye artifact-e kamel, **bedune Docker**.
2. **Dockerfile** (ticket 28) — image-e app: multi-stage, `node:22-bookworm-slim` (glibc), non-root, faghat production deps + se `dist/`. node-pty va SDK rooye glibc clean install mishan.
3. **docker-compose + Caddy** (ticket 29) — app + Caddy sidecar; Caddy TLS terminate mikone (Let's Encrypt) va reverse-proxy be app; `~/.claude` named volume, `PROJECTS_ROOT` bind mount, secret-ha az env/Docker-secret; `init: true` + `/healthz` healthcheck.
4. **Deploy docs + verification** (ticket 30) — README «Deploy» section (env contract, cert story), va ye verification-e end-to-end az compose.

**No protocol.ts change.** In slice hich taghiri dar envelope-e `/ws`, dar shared types, ya dar auth nemide — faghat packaging + ye route-e static-e auth-exempt. (shared ro yek bar barāye chizi ke nist — nadarim — edit nemikonim.)

## User Stories

1. As a developer, I want `npm run build && npm start` to serve the login screen and the whole UI, so that the app is a single deployable artifact without a Vite dev server.
2. As an operator, I want the SPA bundle served publicly while `/api/**` and `/ws**` stay gated, so that the login screen loads without a session but no data leaks (story 14, finally observable).
3. As an operator, I want `WEB_ROOT` to point at the built client, so that the same server image can serve any build output location.
4. As a developer, I want an unset `WEB_ROOT` to change nothing, so that the Vite dev loop keeps serving the client itself.
5. As a developer, I want a client-side route (a refresh on a non-root path) to fall back to `index.html`, so that the SPA never 404s on a deep link.
6. As an operator, I want one `docker compose up` that starts the app and a TLS-terminating proxy, so that the whole product comes up on a domain with HTTPS.
7. As an operator, I want the app image built from a glibc Debian base, so that node-pty's prebuilds and the SDK's bundled binary load without a musl rebuild.
8. As an operator, I want a multi-stage build that ships only production dependencies and the compiled `dist/` trees, so that the image stays small and has no build toolchain in it.
9. As a security-conscious operator, I want the container to run as a non-root user with a writable HOME, so that the pty-spawned shells and the transcript store do not run as root (decision 02).
10. As an operator, I want `~/.claude` (the SDK transcript store) on a named volume, so that session history survives a container restart.
11. As an operator, I want `PROJECTS_ROOT` bind-mounted from the host, so that the container edits the host's real project directories.
12. As an operator, I want the password and API key supplied as env/secret-file, so that no credential is baked into the image.
13. As an operator, I want the app service unreachable from outside the compose network (only Caddy published), so that the only public entry point is TLS-terminated.
14. As an operator, I want a healthcheck on `/healthz` for both the app and the proxy, so that a dead app is marked unhealthy and restarted.
15. As an operator, I want `init: true` (tini) on the app container, so that Node receives SIGTERM and shuts down gracefully.
16. As an operator, I want the app to bind `0.0.0.0` inside the container (not loopback), so that Caddy can reach it over the compose network.
17. As an operator, I want a documented deploy contract (env vars, secrets, certs, volumes), so that deploying to a real server is a checklist, not tribal knowledge.

## Implementation Decisions

### Ticket 27 — Serve the built SPA

- **New server dependency: `@fastify/static`.** Registered on `buildApp`, auth-exempt, at the root — never inside the gated `/api` scope.
- **`AppOptions` gains `webRoot: string | null`.** `null` (dev, most tests) → no static route, exactly today's behavior. This is *config*, not a seam: it holds a path, no facade behind it. The "fourth and last injected seam" comment on `AppOptions` gets one clarifying line ("`webRoot` is configuration, not a seam — there is nothing to fake").
- **`ServerConfig.webRoot`** reads `WEB_ROOT` (trimmed), unset/blank → `null`. Env-only, like `UI_PASSWORD` — it names a build artifact, not operator policy, so no config-file fallback.
- **Serving:** `GET /` and `/assets/**` from `webRoot`, SPA fallback — a `setNotFoundHandler` on the static scope returns `index.html` for a non-file `Accept: text/html` GET. `/healthz`, `/api/**`, `/ws`, `/ws/terminal` must still win over the static catch-all (the explicit routes are registered first; the ticket's tests pin this).
- **`npm start` stays `node dist/main.js`**; the server only serves the bundle when `WEB_ROOT` is set, so the dev loop (`npm run dev`, Vite serves the client) is untouched.

### Ticket 28 — Dockerfile

- **Two stages:**
  - **builder** — `node:22` (full image): copy the three `package.json`s + lockfile, `npm ci`, copy source, `npm run build` (builds `shared` → `server` → `web`).
  - **runtime** — `node:22-bookworm-slim` (glibc): install a shell (`bash` — slim ships only `dash`, and node-pty spawns `$SHELL`), then production deps only plus the built trees.
- **Production deps only.** The monorepo hoists to the root `node_modules`; the runtime stage re-installs with `--omit=dev` so the image carries server's runtime deps (the SDK binary, node-pty, fastify, `@fastify/*`) and **not** `tsx`/`vitest`/`typescript`/`vite`. `shared` is linked from its built `dist` (no runtime deps of its own); `web` has no runtime node code — its `dist` is static.
- **Non-root:** run as the image's `node` user (uid 1000), `HOME=/home/node`, with a writable `CLAUDE_CONFIG_DIR=/home/node/.claude` (the named volume's mount point, `chown`ed).
- **`CMD ["node", "dist/main.js"]`** with `WORKDIR /app/server`; `EXPOSE 3001`. `.dockerignore` excludes `.git`, `node_modules`, `.scratch`, `dist` (rebuilt in-image), the dev loop's scratch.

### Ticket 29 — docker-compose + Caddy

- **Two services:** `app` (build from the Dockerfile, `init: true`, unpublished) and `caddy` (`caddy:2`, the only published service).
- **Caddyfile:** one site block; `{$CLODECK_DOMAIN}` resolves the host, automatic HTTPS via Let's Encrypt; `reverse_proxy app:3001`. Ports `80` → `443` redirect. The cookie is `Secure`, so HTTPS is the only supported prod path.
- **`app` env:** `HOST=0.0.0.0`, `PORT=3001`, `WEB_ROOT=/app/web` (the copied `web/dist`), `PROJECTS_ROOT=/projects`, `CLAUDE_CONFIG_DIR=/home/node/.claude`, `ANTHROPIC_API_KEY`, and `UI_PASSWORD_FILE=/run/secrets/ui_password`.
- **Volumes:** named `claude-data:/home/node/.claude`; `PROJECTS_ROOT` bind-mounted to `/projects` (the host's real projects dir).
- **Secrets:** the password as a Docker secret (→ `UI_PASSWORD_FILE`), the API key as an env var (the SDK reads it from the server's environment; the server never reads it itself — README's existing contract).
- **Healthcheck:** a `node -e "fetch('http://localhost:3001/healthz')"` on `app` (slim has no curl/wget); Caddy reverse-proxies, its own health uses the same endpoint.

### Ticket 30 — Deploy docs + verification

- **README "Deploy" section:** the env contract (`CLODECK_DOMAIN`, `ANTHROPIC_API_KEY`, `UI_PASSWORD_FILE`, `PROJECTS_ROOT`), the secret-file shape, the Let's Encrypt requirement (a reachable domain + ports 80/443), and the `docker compose up -d` happy path.
- **Verification (the "drive it by hand" for this slice):** `docker compose up -d`, then `curl https://<domain>/healthz`, a login through HTTPS (cookie `Secure`), and a project visible from a bind-mounted `PROJECTS_ROOT`. Recorded in the ticket's Evidence, the same way the auth slice recorded its by-hand run.

## Testing Decisions

- **What makes a good test:** assert external behavior only. For static serving, the HTTP status + body + content-type of `/` and an asset path, the SPA fallback, and that `/healthz` / gated `/api` / the WS upgrades are unaffected. For the packaging, the test *is* the build+run: `docker build` succeeds, `docker run` answers `/healthz` and serves `/` (the login screen).
- **Ticket 27 (the one testable slice in-repo):** a `static.test.ts` (or an `app.test.ts` extension) that builds an app with a temp `webRoot` fixture (a real `index.html` + an `assets/app.js`) and asserts: `GET /` → 200 + `text/html`, `GET /assets/app.js` → 200 + the file, `GET /some/deep/route` → `index.html` (fallback), `GET /healthz` → 200, `GET /api/projects` → 401 unauthenticated (the gate still wins), an unauthenticated `/ws` upgrade → still refused. And `webRoot: null` → `GET /` 404s (no static). The config test extends `config.test.ts`: `WEB_ROOT` read, blank → null, unset → null.
- **Tickets 28–30 are verified by build+run, not unit tests:** no in-repo test mocks Docker. The Dockerfile's correctness is `docker build` + `docker run` + `/healthz` + `/`; the compose's is `docker compose up` + the proxy answering over HTTPS. This is the same posture as "drive the browser by hand" — the evidence is a recorded run, not a Vitest file.
- **Non-goal:** no Docker-in-CI, no image scanning, no multi-arch builds, no k8s manifests.

## Out of Scope

- **Direct TLS in the app** (07's "cert path" fallback) — Caddy terminates TLS; the app image is standalone-usable, but wiring `https` certs into `main.ts` is not this slice.
- **Live project push / watchers** — unchanged; discovery stays on-demand.
- **A database/Redis session store** — the `SessionStore` stays in-memory; restarting the app logs everyone out (already true, and fine single-user).
- **Multi-user scoping, git explorer, plugins, browser-use, markdown preview, model picker** — out of MVP per `AGENTS.md`.
- **CI that builds/pushes the image** — the Dockerfile is built locally for now.
- **Graceful drain of in-flight turns on SIGTERM** beyond what Node does by default — noted, not engineered.

## Further Notes

- **This is the last wayfinder slice (08) collapsing into a build slice.** The wayfinder decision (`.scratch/web-claude-ui/issues/08-docker-image.md`) is already resolved; this spec re-expresses it against the *code that now exists* and adds the one thing the decision never had to answer — **who serves the SPA** (the server does, ticket 27). Everything else (topology, glibc, non-root, volumes, secrets, healthcheck) is a restatement of 08 §1–§4.
- **The slice is four tickets in a strict chain** — 27 → 28 → 29 → 30. Each one's artifact is the next one's input, so there is no parallel frontier; the blocker edges below are real.
- **`@fastify/static` is the one new server dependency**; `caddy:2` and `node:22-*` are image refs, not npm deps. No `shared` change, no `protocol.ts` change.
- **Story 14 becomes true for the first time** here (ticket 27): the bundle is public, the data is gated. That closes the one spec-intent gap the auth slice recorded rather than fixed (ticket 26's "Noted").
- **The dev loop is deliberately unchanged.** `WEB_ROOT` unset → no static; Vite keeps serving the client on 5173. Docker is a *deploy* path, not a dev replacement — do not make `npm run dev` go through the image.
- **Ticket split** (continues from `26`, for `/to-tickets`):
  - (27) Serve the built SPA — `@fastify/static`, `WEB_ROOT` config, SPA fallback, auth-exempt, `static.test.ts` + config test.
  - (28) Dockerfile + `.dockerignore` — multi-stage glibc, non-root, prod deps, bash shell.
  - (29) `docker-compose.yml` + `Caddyfile` — app + Caddy sidecar, TLS, volumes, secrets, healthcheck, `init: true`.
  - (30) README "Deploy" docs + the end-to-end compose verification.
