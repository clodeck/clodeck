# 30: Deploy docs + end-to-end verification

**What to build:** The README "Deploy" section that turns the compose file into a documented contract — the env vars, the secret-file shape, the Let's Encrypt requirement, and the happy path — plus the end-to-end verification that the whole slice actually serves a user over HTTPS.

**Blocked by:** 29 (the docs describe the running compose, and the verification runs it)

**Status:** resolved

- [x] README gains a "Deploy" section: the env contract (`CLODECK_DOMAIN`, `ANTHROPIC_API_KEY`, `UI_PASSWORD_FILE`, `PROJECTS_ROOT`), the secret-file shape, the Let's Encrypt requirement (a reachable domain + ports 80/443), and the `docker compose up -d` happy path.
- [x] README notes `WEB_ROOT` in the configuration table (env-only, the server serves the SPA when set; the dev loop stays on Vite).
- [x] The handoff's "server does not serve the built client yet" note and the corresponding README line are corrected — the server now serves the built client when `WEB_ROOT` is set.
- [x] End-to-end verification recorded in Evidence: `docker compose up -d`, `curl https://<domain>/healthz` → 200, a login through HTTPS sets the `Secure` cookie, a project from the bind-mounted `PROJECTS_ROOT` is visible — the same by-hand posture as the auth slice's evidence.

## What landed

```
README.md   §Deploy (new): the image standalone — docker build + docker run, what localhost can and
            cannot prove about the Secure cookie — then the compose happy path (secrets/ui_password.txt,
            the .env block), a table of the four variables and what each one binds to, the volumes, what
            is in the image, and the bring-your-own-proxy alternative.
            Configuration table: the WEB_ROOT row (unset → no client served; set → the SPA + fallback).
            "To run the backend on its own" no longer says the server cannot serve the client: it says
            how (WEB_ROOT) and why the path resolves against server/.
            Status paragraph: the app deploys.
```

## Decisions the spec did not pin

- **The docs spell out that the domain must resolve to the host and 80/443 must be reachable**, because
  "automatic HTTPS" is otherwise a promise with a hidden prerequisite — a hostname that does not resolve
  means Caddy retries the ACME challenge and the site never answers.
- **The standalone `docker run` example uses plain HTTP on `localhost` on purpose**, and says why a
  browser accepts the `Secure` cookie there while a non-local plain-HTTP host would not. That is the one
  subtlety an operator following the quick path would otherwise trip over.
- **`WEB_ROOT` is documented as env-only** in the table's own row, not by omission from the config-file
  paragraph: unlike `projectsRoot` there is no `clodeck.config.json` fallback, and the row says so.

## Evidence

The end-to-end run on 2026-10-11, over HTTPS through Caddy, against the compose stack
(`CLODECK_DOMAIN=localhost` → Caddy's internal CA, since this machine has no public domain;
`PROJECTS_ROOT=D:/work/clodeck-projects`; the password read from `secrets/ui_password.txt`):

```
docker compose up -d
docker compose ps
  clodeck-app-1    Up (healthy)   3001/tcp                                  ← internal only
  clodeck-caddy-1  Up (healthy)   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp  ← the only way in

GET  https://localhost/healthz                 → 200 {"status":"ok"}
GET  https://localhost/                        → 200 text/html; charset=utf-8  title=Clodeck
GET  https://localhost/projects/xyz/sessions   → 200 text/html (the SPA fallback)
GET  https://localhost/api/projects            → 401 {"error":"authentication required"}
POST https://localhost/api/auth/login {dev}    → 200 {"ok":true}
     set-cookie: clodeck_session=<opaque>; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict
GET  https://localhost/api/projects (cookie)   → 200 {"projects":[{"name":"demo","path":"/projects/demo"},
                                                       {"name":"hello","path":"/projects/hello"}]}
http://localhost/healthz                       → 308 → https://localhost/healthz
wss://localhost/ws/terminal?projectId=…        → OPEN, shell echoed "ws-terminal-ok"
```

The bind-mounted projects arriving as `/projects/demo` and `/projects/hello` is the end of the chain the
whole effort was built for: a host directory, through one login, into a real session — and the terminal
socket surviving the proxy proves the raw-byte half does too.

**Not verified, and honestly so:** the Let's Encrypt path itself (no public domain here — the run used
Caddy's internal CA), and the browser experience (login screen → shell → logout, the xterm panel, the file
drawer), which no run in this repo has ever covered. Everything above was driven by requests, not by a
human in a browser.
