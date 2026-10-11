# 29: docker-compose + Caddy sidecar

**What to build:** The deployment topology: an `app` service built from the image and a `caddy` reverse-proxy sidecar that terminates TLS and reverse-proxies to it. The app is unpublished (compose-internal only), runs under `init: true` with a `/healthz` healthcheck, gets `~/.claude` on a named volume and `PROJECTS_ROOT` bind-mounted, and takes its secrets from env/Docker-secret.

**Blocked by:** 28 (the compose builds and references the image)

**Status:** ready-for-agent

- [ ] `docker-compose.yml` defines `app` (build from the Dockerfile, `init: true`, no published ports) and `caddy` (`caddy:2`, the only published service — `80` → `443`).
- [ ] `Caddyfile`: one site block on `{$CLODECK_DOMAIN}`, automatic HTTPS via Let's Encrypt, `reverse_proxy app:3001`.
- [ ] `app` env: `HOST=0.0.0.0`, `PORT=3001`, `WEB_ROOT=/app/web`, `PROJECTS_ROOT=/projects`, `CLAUDE_CONFIG_DIR=/home/node/.claude`, `ANTHROPIC_API_KEY`, `UI_PASSWORD_FILE=/run/secrets/ui_password`.
- [ ] Volumes: named `claude-data:/home/node/.claude`; `PROJECTS_ROOT` bind-mounted to `/projects`.
- [ ] Secrets: the password as a Docker secret (→ `UI_PASSWORD_FILE`), the API key as an env var.
- [ ] `app` healthcheck hits `/healthz` with `node -e "fetch(…)"` (slim has no curl/wget); Caddy's own health uses the same endpoint.
- [ ] Verified by build+run: `docker compose up -d`, then `curl https://<domain>/healthz` and a login through HTTPS (cookie `Secure`) — recorded in the ticket's Evidence.
