# Clodeck

Remote browser access to Claude Code across multiple project directories: a chat UI over the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview), one session per project, with
a terminal and a file drawer alongside. One user, one dedicated server that also hosts the project
folders.

**Status: the MVP's four surfaces are built.** Project discovery, `GET /api/projects` and the project
switcher work end to end. So does the chat surface: streaming Agent SDK turns over a WebSocket bus at
`/ws`, tool cards, the approval modal, and session history / resume over REST. So does the terminal: a
per-project shell (node-pty behind a facade) streamed as raw bytes over `/ws/terminal` into an
xterm.js panel, resized over REST. So does the file drawer: a tree that expands in place, with
create / rename / delete / upload and an editable preview that saves back to disk, all scoped to the
project root. Auth fronts all of it — single password, httpOnly session cookie, and everything except
`/healthz` and the login routes behind a gate. It deploys: the server serves the built client itself, so
`docker compose up -d` brings the whole product up behind a TLS-terminating proxy (see [Deploy](#deploy)).

## Layout

Three npm workspaces, scoped `@clodeck/*`:

| Package | What it owns |
|---|---|
| [`shared/`](shared) | `@clodeck/shared` — the domain types (`Project`, `Principal`) and the transport contracts (the event/message envelopes, the Agent SDK message mirror). Both other packages import it, so a contract change breaks compilation on both sides at once. |
| [`server/`](server) | `@clodeck/server` — the Node/Fastify backend: project discovery over the filesystem, the Agent SDK behind a provider facade, the session bus at `/ws`, the terminal, the scoped file access, and the auth gate over all of it. |
| [`web/`](web) | `@clodeck/web` — the React + Vite + Tailwind client: the login screen, the project switcher, the streaming chat surface, the xterm.js terminal and the file drawer. |

## Requirements

Node ≥ 22.12 (npm workspaces). Nothing else — no database, no global tooling.

## Commands

Every command runs from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces. |
| `npm run dev` | Builds `shared`, then runs the server (`tsx watch` — reloads on change) and the web client (Vite dev server) together. |
| `npm run dev:fake` | The same, but the server runs the scripted fake Agent SDK provider instead of the real one — the whole chat surface with no API key and no network. Use this for UI work. It still needs `UI_PASSWORD`: the gate is installed the same way, so an unset password is fail-closed here too. |
| `npm test` | Builds `shared`, then runs the whole Vitest suite across all packages. |
| `npm run build` | Builds `shared` → `server` → `web` into each package's `dist/`. |
| `npm run typecheck` | Type-checks every package (`tsc` with `noEmit` — nothing is written). |

`dev`, `test`, `build`, and `typecheck` all build `shared` first, because `server` and `web` resolve
it through its built `exports` (`shared/dist`) — a clean clone has nothing to import until that
happens. For the same reason, editing `shared/` while `npm run dev` is running needs a
`npm run build:shared` (or a restart) before the server and client see the change.

`npm run dev` passes `--raw` to `concurrently` on purpose — do not "restore" the `-n server,web`
prefixes there. `concurrently`'s line-prefixing streams deadlock the *real* Agent SDK's import when
the server runs under `tsx watch`: the server process starts, prints nothing, never listens, and the
client's proxy answers 502 for `/api/projects`. `--raw` passes the children's output straight
through and the loop works; the cost is the `[server]`/`[web]` prefixes. `dev:fake` never imports
the SDK, so it keeps them.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROJECTS_ROOT` | — | The directory whose immediate child directories are the projects. Unset or empty → an empty list, never an error. |
| `UI_PASSWORD` | — | The single account's password. Unset or empty → the server boots **fail-closed**: every route and socket answers 401 and no login can succeed. |
| `UI_PASSWORD_FILE` | — | Read only when `UI_PASSWORD` is unset: a file whose trimmed contents are the password (the Docker-secret shape). |
| `PORT` | `3001` | The server's port. The Vite dev proxy targets the same value, so `PORT=3300 npm run dev` moves both halves together. |
| `HOST` | `127.0.0.1` | The server's bind address. Loopback by default as defense in depth — the auth gate, not the bind address, is what keeps the surface closed. A container sets it to bind its own interface. |
| `WEB_ROOT` | — | The built client's directory. Unset → the server serves no client at all, which is what the Vite dev loop wants. Set (the image sets it to `/app/web/dist`) → the server serves the SPA at `/`, auth-exempt with an `index.html` fallback for deep links, and `npm run build && npm start` is the whole app. |
| `ANTHROPIC_API_KEY` | — | Read by the Agent SDK from the server's environment; the server itself never reads, stores or forwards it. Only the real provider needs it — `npm run dev:fake` needs none. |

`clodeck.config.json` is the fallback for deployments that would rather not export an environment
variable. It is read from the server's working directory — which is `server/`, not the repo root,
when the root scripts run it, because npm runs a workspace script there:

```json
{ "projectsRoot": "/srv/projects" }
```

### When the dev server answers 502

A 502 from the client is the **proxy** failing, not the app: Vite could not reach the backend, and
the backend's own log says nothing at all — because it never started. On Windows the usual cause is
that the OS is holding the port:

```
Error: listen EACCES: permission denied 127.0.0.1:3001
```

Hyper-V and WSL reserve themselves dynamic port ranges at boot — `2980–3079` on the machine where
this was first hit, which contains 3001 — and everything inside them is unbindable. See them with:

```sh
netsh interface ipv4 show excludedportrange protocol=tcp
```

Two ways out. Move the port (`PORT=3300 npm run dev` — the proxy follows it), or hand the ranges
back for this boot with an **elevated** shell:

```sh
net stop winnat && net start winnat
```

Nothing about the app is wrong in either case: no code change, no config change, and no amount of
reading the server's log will show it.

## Try it

```sh
npm install
mkdir -p ~/clodeck-projects/hello
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm run dev
```

Then open <http://localhost:5173>, sign in with `dev`, and the shell appears. The Vite dev server
proxies both `/api` and `/ws` to the backend on `127.0.0.1:3001`, so the client develops against the
real endpoints with no CORS setup — and the session cookie rides both the REST calls and the
WebSocket upgrades, because they are same-origin. Drop another directory into the projects root and
press the switcher's refresh; select a project and the chat panel opens a session against it.

`UI_PASSWORD` is not optional in practice: without it the server boots fail-closed and the login
screen can never get past it. The cookie is `Secure`, which browsers allow on `http://localhost` —
production is HTTPS behind the proxy.

Without an API key, run `npm run dev:fake` instead — the server then answers from a scripted fake
provider, so the whole chat surface (streaming, tool cards, the approval modal, history and resume)
is exercisable offline.

On Windows PowerShell:

```powershell
$env:UI_PASSWORD = "dev"; $env:PROJECTS_ROOT = "$HOME\clodeck-projects"; npm run dev
```

To run the backend on its own, serving the client it just built — no Vite at all:

```sh
npm run build
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects WEB_ROOT="$PWD/web/dist" \
  npm start --workspace @clodeck/server
```

`WEB_ROOT` resolves like `PROJECTS_ROOT` does — against the working directory, which is `server/`
when a workspace script runs it — so pass an absolute path when in doubt. Then
<http://127.0.0.1:3001> is the app: the login screen, the shell, everything. `/healthz` and the whole
`/api` and `/ws` surface work exactly as under Vite; only the client's origin changed.

## Auth

One account, password only. `POST /api/auth/login` checks the password against a salted **scrypt**
hash (built from `UI_PASSWORD` at boot; the plaintext is never kept), sets an `HttpOnly; Secure;
SameSite=Strict` session cookie, and every `/api/**` route plus both `/ws` and `/ws/terminal` require
it — `/healthz` and the two login routes are the only exemptions. Logins are rate-limited per
address (five failures lock it out), session ids live server-side (a logout or a restart invalidates
them), and a WebSocket upgrade is refused when its `Origin` is not the host it was sent to.

## Deploy

The deployment is two containers: `app` (this repo's `Dockerfile`) and Caddy in front of it,
terminating TLS. Caddy is the only service with published ports, so the app is reachable on the
compose network and nowhere else.

### The app image on its own

The image is the whole product — the server serves the built client — so it runs without the proxy:

```sh
docker build -t clodeck .
docker run --rm -p 3300:3001 \
  -e UI_PASSWORD=dev \
  -e PROJECTS_ROOT=/projects \
  -v "$HOME/clodeck-projects:/projects" \
  clodeck
```

<http://localhost:3300> then answers with the login screen and `/healthz` with `{"status":"ok"}`. Browsers
treat `http://localhost` as trustworthy, so the `Secure` session cookie works there; any other plain-HTTP
host cannot hold a login, which is what the proxy below is for.

### The compose deployment

```sh
mkdir -p secrets
openssl rand -base64 24 > secrets/ui_password.txt   # this becomes the login password
cat > .env <<'EOF'
CLODECK_DOMAIN=clodeck.example.com
PROJECTS_ROOT=/srv/clodeck-projects
ANTHROPIC_API_KEY=sk-ant-...
UI_PASSWORD_FILE=./secrets/ui_password.txt
EOF
docker compose up -d
```

| Variable | What it is |
|---|---|
| `CLODECK_DOMAIN` | The public hostname. It is Caddy's site address and the name on the certificate, so it must resolve to this host — **ports 80 and 443 reachable from the internet**, since the certificate is obtained and renewed automatically (Let's Encrypt). There is no cert file to manage. |
| `PROJECTS_ROOT` | The **host** directory whose immediate child directories are the projects. Bind-mounted at `/projects` inside the app. |
| `ANTHROPIC_API_KEY` | Read by the Agent SDK from the app's environment. No key, no real chat — the container boots and the login works regardless. |
| `UI_PASSWORD_FILE` | A file whose trimmed contents are the login password. Compose mounts it at `/run/secrets/ui_password`; the password is never an environment variable (it would show up in `docker inspect`) and never an image layer. Defaults to `./secrets/ui_password.txt`. |

`docker compose` reads `.env` from this directory automatically, so the whole happy path is
`docker compose up -d`. Then `curl https://$CLODECK_DOMAIN/healthz` answers `{"status":"ok"}`, and the
login screen at `https://$CLODECK_DOMAIN` signs in with the contents of the password file.

Three volumes keep state across restarts: `claude-data` (the Agent SDK's transcript store, mounted at
`/home/node/.claude` — session history survives, and is deliberately *not* the host's own `~/.claude`),
and `caddy-data` / `caddy-config` (the issued certificates and the ACME account key).

Only what the app needs is in the image: production dependencies and the three `dist/` trees, running as
the image's unprivileged `node` user. `node-pty`'s Linux binding is compiled during the build — the
tarball ships prebuilds for macOS and Windows only — which is why the dependency stage carries a
toolchain and the shipped image does not.

If you already run a reverse proxy, skip this compose file: publish the app's port on the proxy's
network (`127.0.0.1:3001:3001`) and terminate TLS in front of it. Nothing in the app requires Caddy.

## Docs

- [`AGENTS.md`](AGENTS.md) — working conventions for this repo: language, and how the local issue
  tracker is laid out.
- [`.scratch/clodeck/`](.scratch/clodeck) — the current build effort: spec, tickets, handoff.
- [`.scratch/web-claude-ui/`](.scratch/web-claude-ui) — the wayfinder spec and the verified visual
  prototype the UI follows.
