# 29: docker-compose + Caddy sidecar

**What to build:** The deployment topology: an `app` service built from the image and a `caddy` reverse-proxy sidecar that terminates TLS and reverse-proxies to it. The app is unpublished (compose-internal only), runs under `init: true` with a `/healthz` healthcheck, gets `~/.claude` on a named volume and `PROJECTS_ROOT` bind-mounted, and takes its secrets from env/Docker-secret.

**Blocked by:** 28 (the compose builds and references the image)

**Status:** resolved

- [x] `docker-compose.yml` defines `app` (build from the Dockerfile, `init: true`, no published ports) and `caddy` (`caddy:2`, the only published service — `80` → `443`).
- [x] `Caddyfile`: one site block on `{$CLODECK_DOMAIN}`, automatic HTTPS via Let's Encrypt, `reverse_proxy app:3001`.
- [x] `app` env: `HOST=0.0.0.0`, `PORT=3001`, `WEB_ROOT=/app/web`, `PROJECTS_ROOT=/projects`, `CLAUDE_CONFIG_DIR=/home/node/.claude`, `ANTHROPIC_API_KEY`, `UI_PASSWORD_FILE=/run/secrets/ui_password`.
- [x] Volumes: named `claude-data:/home/node/.claude`; `PROJECTS_ROOT` bind-mounted to `/projects`.
- [x] Secrets: the password as a Docker secret (→ `UI_PASSWORD_FILE`), the API key as an env var.
- [x] `app` healthcheck hits `/healthz` with `node -e "fetch(…)"` (slim has no curl/wget); Caddy's own health uses the same endpoint.
- [x] Verified by build+run: `docker compose up -d`, then `curl https://<domain>/healthz` and a login through HTTPS (cookie `Secure`) — recorded in the ticket's Evidence.

## What landed

```
docker-compose.yml   app (build: ., init: true, restart: unless-stopped, no ports, env per the ticket,
                     claude-data volume + PROJECTS_ROOT bind mount, node-fetch healthcheck) and caddy
                     (caddy:2, ports 80+443 only, Caddyfile mounted read-only, caddy-data/config volumes,
                     healthcheck on the admin API, depends_on: app healthy).
Caddyfile            {$CLODECK_DOMAIN} { reverse_proxy app:3001 { health_uri /healthz } } — automatic
                     HTTPS, HTTP→HTTPS redirect, WebSocket upgrades passed through.
.gitignore           secrets/ — the password file the compose `secrets:` entry reads.
```

## Decisions the spec did not pin

- **Caddy's *upstream* health is `/healthz` (`health_uri`); the container healthcheck probes the admin
  API.** The spec's "its own health uses the same endpoint" is exactly the `health_uri` line. The
  container-level probe cannot use `/healthz`: inside the container, port 80 only ever answers the
  HTTPS redirect, and busybox wget cannot verify a Let's Encrypt certificate for `{$CLODECK_DOMAIN}`. The
  admin API on `:2019` answers the question this check is actually for — "is the proxy alive with a config
  loaded" — and Caddy's own `depends_on` gate is the app's health, which is the part that matters.
- **`${VAR:?message}` for `CLODECK_DOMAIN`, `PROJECTS_ROOT` and `ANTHROPIC_API_KEY`.** Compose then refuses
  to start without them instead of booting an app with an empty projects root that silently lists nothing.
  The cost is that every `docker compose` subcommand needs the same `.env` — which is the file the README
  tells the operator to write once.
- **`WEB_ROOT=/app/web/dist`, not `/app/web`.** The ticket's env list says `/app/web`; the image copies the
  built client to `/app/web/dist` (ticket 28), and `@fastify/static` needs the directory that holds
  `index.html`. This is the one place the two tickets disagreed, and the artifact wins.
- **`depends_on: { app: { condition: service_healthy } }`** so Caddy never starts against a dead app —
  Caddy would otherwise serve 502s during the boot window and the ACME challenge could fail.
- **`restart: unless-stopped` on both**, which the ticket does not mention but a deploy that survives a
  host reboot needs.

## Evidence

By hand on 2026-10-11, with `CLODECK_DOMAIN=localhost` (Caddy's internal CA — there is no public domain
here, which is the one branch of this ticket no local run can exercise), `PROJECTS_ROOT=D:/work/clodeck-projects`
and `secrets/ui_password.txt` holding `dev`:

```
docker compose up -d
  → Network clodeck_default, volumes clodeck_{claude-data,caddy-data,caddy-config}
  → clodeck-app-1: Created → Started → Waiting → Healthy (the healthcheck gates the proxy)
  → clodeck-caddy-1: Started

docker compose ps
  clodeck-app-1    Up (healthy)   3001/tcp                        ← exposed, never published
  clodeck-caddy-1  Up (healthy)   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
docker compose port app 3001                                       → :0  (no host port)
docker compose logs caddy
  → "enabling automatic TLS certificate management" domains=["localhost"]
  → "certificate obtained successfully"
```

Through the proxy (the ticket-30 end-to-end run, which is the same stack — full transcript there):

```
https://localhost/healthz              → 200 {"status":"ok"}
https://localhost/                     → 200 text/html, the login screen
https://localhost/projects/xyz/sessions → 200 text/html (SPA fallback, deep link)
https://localhost/api/projects          → 401 anonymous
POST https://localhost/api/auth/login  → 200, cookie "HttpOnly; Secure; SameSite=Strict"
https://localhost/api/projects          → 200, the bind-mounted projects (demo, hello)
http://localhost/healthz               → 308 → https://localhost/healthz
wss://localhost/ws/terminal            → OPEN over the proxy; the shell echoed the test line
```
