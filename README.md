# Clodeck

Remote browser access to Claude Code across multiple project directories: a chat UI over the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview), one session per project — the
chat takes the stage, and the shell and the file viewer share one bottom drawer summoned from the
rail. One user, one dedicated server that also hosts the project folders.

**Status: the MVP's four surfaces are built.** Project discovery, the project switcher, and creating
a project from the sidebar (`POST /api/projects`) work end to end. So does the chat surface: streaming
Agent SDK turns over a WebSocket bus at `/ws`, tool cards, the approval modal, and session history /
resume over REST. So does the terminal: a per-project shell (node-pty behind a facade) streamed as raw
bytes over `/ws/terminal` into an xterm.js panel, resized over REST. So does the file drawer: a tree that expands in place, with
create / rename / delete / upload and an editable preview that saves back to disk, all scoped to the
project root. Auth fronts all of it — single password, httpOnly session cookie, and everything except
`/healthz` and the login routes behind a gate. It deploys: the server serves the built client itself, so
`docker compose up -d` brings the whole product up behind a TLS-terminating proxy (see [Deploy](#deploy)).

**Starting from a clean clone?** [Bring it up](#bring-it-up) is the path from `npm install` to a
signed-in browser, step by step and per shell. Something already went wrong? [Troubleshooting](#troubleshooting).

## Layout

Three npm workspaces, scoped `@clodeck/*`:

| Package | What it owns |
|---|---|
| [`shared/`](shared) | `@clodeck/shared` — the domain types (`Project`, `Principal`) and the transport contracts (the event/message envelopes, the Agent SDK message mirror). Both other packages import it, so a contract change breaks compilation on both sides at once. |
| [`server/`](server) | `@clodeck/server` — the Node/Fastify backend: project discovery over the filesystem, the Agent SDK behind a provider facade, the session bus at `/ws`, the terminal, the scoped file access, and the auth gate over all of it. |
| [`web/`](web) | `@clodeck/web` — the React + Vite + Tailwind client: the login screen, the project switcher, the streaming chat surface, the xterm.js terminal and the file drawer. |

## Requirements

| What | Why | Check / install |
|---|---|---|
| **Node ≥ 22.12** | npm workspaces; the server runs under `tsx` in dev and plain `node` in production. npm comes with it. | `node --version` |
| **A directory to hold your projects** | The app keeps no database: the folders in it *are* the projects. Any path you can write to. | — |
| `python3`, `make`, `g++` — **Linux only** | `npm install` compiles one native module (`node-pty`, the terminal's pty). macOS and Windows get a prebuilt binary. | `apt-get install -y python3 make g++` |
| **An Anthropic API key** — one feature only | The **chat answer** comes from the Claude Agent SDK, which reads `ANTHROPIC_API_KEY` from the server's environment. Login, the terminal, the file drawer and session history all work without one, and `npm run dev:fake` stands in for offline UI work. | — |

Nothing else: no database, no global tooling.

## Bring it up

Two processes, one browser tab. The **server** (Fastify, `127.0.0.1:3001` by default) owns the
filesystem, the terminal and the Agent SDK; the **client** (Vite, `localhost:5173`) is the UI.
`npm run dev` starts both, and Vite proxies `/api` and `/ws` to the server — so the browser only ever
talks to port 5173, there is no CORS to configure, and the session cookie rides the API calls and the
WebSocket upgrades alike, because they are same-origin.

Two environment variables decide everything else:

| Variable | What it is |
|---|---|
| `PROJECTS_ROOT` | The directory whose **immediate child directories** are your projects. This is the app's entire registry — there is no config file listing them. |
| `UI_PASSWORD` | The one password you sign in with. |

### 1. Install

```sh
git clone <this repo> clodeck      # if you have not already
cd clodeck
npm install
```

That installs all three workspaces (`shared`, `server`, `web`) and wires the repo's pre-commit hook.
On Linux it also compiles `node-pty` — see [Requirements](#requirements) for the toolchain it needs.

### 2. Make a projects root

Each immediate child directory of this path is one project; the app never looks deeper. Create the
root and one project to look at:

```sh
mkdir -p ~/clodeck-projects/hello            # macOS, Linux, Git Bash
```
```powershell
mkdir $HOME\clodeck-projects\hello           # Windows PowerShell
```
```cmd
mkdir "%USERPROFILE%\clodeck-projects\hello"  rem  Windows CMD
```

The root itself has to exist: a missing root is not an error, but it is an empty list — and the
sidebar's create button has nowhere to write. (You do not have to make `hello` by hand; step 5 creates
projects from the app.)

### 3. Start it

The variables are read by the **server**, so they go in front of `npm run dev`, whose environment is
passed on. Pick your shell:

```sh
# macOS / Linux (bash, zsh)
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm run dev
```
```powershell
# Windows PowerShell
$env:UI_PASSWORD = "dev"; $env:PROJECTS_ROOT = "$HOME\clodeck-projects"; npm run dev
```
```cmd
rem  Windows CMD
set UI_PASSWORD=dev
set PROJECTS_ROOT=%USERPROFILE%\clodeck-projects
npm run dev
```
```sh
# Git Bash on Windows — forward slashes: backslashes are eaten on the way in
UI_PASSWORD=dev PROJECTS_ROOT=/c/Users/<you>/clodeck-projects npm run dev
```

- **`UI_PASSWORD=dev`** is exactly that: a dev password. Anything non-empty works, and it is what you
  type at the login screen. Leaving it out is not a soft failure — the server boots **fail-closed**,
  warns `UI_PASSWORD is not set: every /api route and both websockets will answer 401`, and no login
  can succeed. A server with no credential must not be an open one.
- **`PROJECTS_ROOT=…`** is the folder from step 2. Leaving it out starts the app anyway, with an empty
  project list and the warning `no projects root configured — set PROJECTS_ROOT or projectsRoot in
  clodeck.config.json`. Both warnings name the fix, so read the server's first lines.
- **Add `PORT=3300`** in front of any block above to move the server's port; the Vite proxy reads the
  same variable, so the two halves move together. On Windows, 3001 is often reserved by the OS before
  anything starts — see [Troubleshooting](#troubleshooting).

### 4. Open it, and sign in

Two lines tell you both halves came up — the server's, then the client's:

```
clodeck server listening on http://127.0.0.1:3001
```

…and, from Vite, a `Local: http://localhost:5173/` line. Open <http://localhost:5173>, type the
password you set, and the workspace appears:

```text
┌─────┬─────────────────┬────────────────────────────────────┐
│Chat │ Projects        │  the selected project: its name,   │
│Term │  hello          │  its path on disk, and its chat —  │
│Files│  demo           │  transcript above, composer below  │
│     │  New project    │                                    │
│rail │  Refresh        │                                    │
│     │                 ├────────────────────────────────────┤
│     │                 │  the drawer: Terminal ⇄ Files —    │
│     │                 │  or nothing, while the chat has    │
│     │                 │  the stage                         │
└─────┴─────────────────┴────────────────────────────────────┘
```

The rail's three buttons are one choice: `Chat` gives the stage back, `Terminal` and `Files` open the
one drawer below it, for the selected project. Nothing shows until a project is selected. Port 3001 is
the API in this mode, not a page — the client at 5173 is the only thing to open.

### 5. What to do first

- **The sidebar lists your projects.** `hello` from step 2 is there; selecting it opens its chat stage,
  whose header shows the project's name and where it lives on disk.
- **`New project`** (in the sidebar header, and again in the empty state) creates a project for real:
  one `mkdir` under `PROJECTS_ROOT`, no template, no `git init`, nothing else. The list reloads, the
  new project is selected, and a `created <name>` toast says so.
- **Chat** is the one surface that needs the API key (step 7): type in the composer and the turn
  streams back from the Agent SDK, with tool cards and an approval modal when the agent asks.
- **The rail's `Terminal` and `Files`** open one bottom drawer for the selected project: a real shell
  whose working directory is that project's folder, and that project's file tree — preview (markdown
  rendered, code with a numbered gutter), edit and save, create, rename, delete, upload, download, and
  drag a file onto a folder to move it. Both are scoped to the project root and cannot reach outside.
- **What the app does is what the disk shows.** `ls ~/clodeck-projects` is the sidebar; a file created
  in the drawer is a file on disk, and the agent's edits show up on the next refresh.

Stop everything with `Ctrl-C` in that shell — both processes go down together.

### 6. Without Vite: the server serving the built client

The same app, one process, no dev server. `WEB_ROOT` is what turns the server into a static host for
the client it just built:

```sh
npm run build
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects WEB_ROOT="$PWD/web/dist" \
  npm start --workspace @clodeck/server
```

Then <http://127.0.0.1:3001> *is* the app — login screen, shell, everything. `/healthz` and the whole
`/api` and `/ws` surface behave exactly as they do under Vite; only the client's origin changed.
`WEB_ROOT` resolves against the working directory, which is `server/` when a workspace script runs it,
so pass an absolute path when in doubt. (This is also how the [Docker image](#the-app-image-on-its-own)
runs, with the image's own paths.)

### 7. Without an API key

```sh
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm run dev:fake
```

The server then answers from a scripted fake Agent SDK provider: the whole chat surface — streaming,
tool cards, the approval modal, history and resume — is exercisable offline, and every other surface is
the real one. It still needs `UI_PASSWORD`: the gate is installed exactly the same way. Use it for UI
work, and for a first look at the app before wiring a key.

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
| `npm run e2e` | Runs the Playwright suite in `web/e2e/` against a dev loop that is already up (see [End-to-end](#end-to-end)). |

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

`npm install` wires a **pre-commit hook** — `.githooks/pre-commit`, through `core.hooksPath` — that
runs `npm run typecheck` and `npm test`. It is the only automatic check this repo has, there being no
CI, so it is what keeps a red tree from being committed. `git commit --no-verify` skips it once. If it
never seems to fire, `git config core.hooksPath` should answer `.githooks`; `npm run prepare` sets it.

## End-to-end

`npm run e2e` drives the real app in a real browser — `web/e2e/`, Playwright. It is **not** part of
`npm test`: it needs a dev loop already running and a browser, neither of which the Vitest suite
touches. So run the two in separate shells:

```sh
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects PORT=3300 npm run dev   # one shell
UI_PASSWORD=dev npm run e2e                                              # another
```

The dev server must be on <http://localhost:5173>, and the server must be hashed against the same
`UI_PASSWORD` the suite sends, because it logs in like a person does. `web/playwright.config.ts` has
the rest.

The suite drives the machine's **installed Chrome** (`channel: 'chrome'`), not a Playwright-downloaded
Chromium — `npx playwright install chromium` fails on this network with `Failed to download Chrome for
Testing`. That is why the config looks the way it does; the comment there says so too, so the next
person does not "fix" it back.

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

## Troubleshooting

### The client answers 502 for everything

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

### The sidebar is empty, though the folder has directories in it

`PROJECTS_ROOT` did not reach the server as the path you meant — and that failure is quiet by design,
because the server's answer to a root it cannot use is an empty list, never an error. The tell is its
warn line, and it says which of the two happened: `no projects root configured — …` when nothing
arrived at all, and `could not read projects root <path>: …` when something arrived that is not a
readable directory. Two traps:

- **Git Bash on Windows eats the backslashes** in `PROJECTS_ROOT=D:\work\projects`: the server then
  scans `D:workprojects` and finds nothing. Use forward slashes (`/d/work/projects`).
- **Only immediate child directories are projects.** One level deeper is not listed; a plain file or a
  dot-directory (`.git`, `.cache`) is not either. A symlink counts, but only if what it points at is
  inside the root.

### The login screen refuses the password I set

`UI_PASSWORD` was unset or blank — a blank value counts as unset — so the server is fail-closed and the
boot warning says which (`UI_PASSWORD is not set: …`). Two more things that look like a wrong password:
`UI_PASSWORD_FILE` is read **only** when `UI_PASSWORD` is unset, and the password is hashed once at
boot, so changing it needs a restart — which also drops every session, since sessions live in the
server's memory. Five failures from one address lock it out for fifteen minutes (a `429`); the login
route answers that even for the correct password.

### Everything works except the chat's answer

The chat turn is the one thing that needs `ANTHROPIC_API_KEY` in the server's environment — the server
never reads it, the Agent SDK does. Without a key the login, the terminal, the file drawer and history
all work and the turn fails; `npm run dev:fake` (step 7) is the offline stand-in, and a *wrong* key
fails at the first turn with the SDK's own error in the chat.

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
| `ANTHROPIC_API_KEY` | Read by the Agent SDK from the app's environment. The compose file **requires** it — `docker compose up` refuses to start without one — but the app itself boots either way: a wrong key fails at the first chat turn, and the login screen, the terminal and the file drawer work regardless. |
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
