# Clodeck

**Remote browser access to Claude Code across multiple project directories.**

Clodeck is a web UI over the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).
One project is one directory: one agent session, one shell, one file drawer. The app runs on a server
you own — the same machine the project folders live on — and you drive it from any browser, on any
machine. One user, one password.

**Status: the MVP's four surfaces are built.** Project discovery, the project switcher, and creating a
project from the sidebar (`POST /api/projects`) work end to end. So does the chat surface: streaming
Agent SDK turns over a WebSocket bus at `/ws`, tool cards, the approval modal, and session history /
resume over REST. So does the terminal: a per-project shell (node-pty behind a facade) streamed as raw
bytes over `/ws/terminal` into an xterm.js panel. So does the file drawer: a tree that expands in
place, with create / rename / delete / upload, and an editable preview that saves back to disk — all
scoped to the project root. Auth fronts every one of them.

**Where to start:** [Quickstart](#quickstart) goes from a clean clone to a signed-in browser on your
own machine. [Run it on a server](#run-it-on-a-server) is the same thing for a Linux box, a Windows
box, or Docker. Stuck? [Troubleshooting](#troubleshooting).

## Contents

- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Run it on a server](#run-it-on-a-server)
  - [The one rule: HTTPS, or localhost](#the-one-rule-https-or-localhost)
  - [Linux server](#linux-server)
  - [Windows server](#windows-server)
  - [Docker](#docker)
  - [Docker Compose with a domain](#docker-compose-with-a-domain)
  - [Day-to-day with the containers](#day-to-day-with-the-containers)
- [Reaching it from another machine](#reaching-it-from-another-machine)
  - [The SSH tunnel](#the-ssh-tunnel)
  - [Why a plain-HTTP address cannot hold a login](#why-a-plain-http-address-cannot-hold-a-login)
- [Configuration](#configuration)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Architecture](#architecture)
- [Development](#development)
- [Docs](#docs)

## What you get

| Surface | What it does |
|---|---|
| **Projects** | The sidebar lists the immediate child directories of `PROJECTS_ROOT`. Select one and its chat takes the stage. `New project` creates one for real — a `mkdir` under the root, nothing else. |
| **Chat** | One Agent SDK session per project: streamed turns, tool cards, an approval modal when the agent asks, and session history you can resume. |
| **Terminal** | A real shell whose working directory is the selected project's folder — a pty (node-pty) streamed as raw bytes into xterm.js. |
| **Files** | The project's tree, expanding in place: preview (markdown rendered, code with a numbered gutter and syntax colouring), edit and save, create, rename, delete, upload, download, and drag a file onto a folder to move it. |
| **Auth** | One password, an `HttpOnly` session cookie, and every route and socket behind it. |

The terminal and the files share **one bottom drawer**, opened from the rail and shut on first load —
the chat keeps the stage.

```text
┌─────┬─────────────────┬────────────────────────────────────┐
│Chat │ Projects        │  the selected project: its name,   │
│Term │  hello          │  its path on disk, and its chat —  │
│Files│  demo           │  transcript above, composer below  │
│     │  New project    │                                    │
│rail │  Refresh        ├────────────────────────────────────┤
│     │                 │  the drawer: Terminal ⇄ Files —    │
│     │                 │  or nothing, while the chat has    │
│     │                 │  the stage                         │
└─────┴─────────────────┴────────────────────────────────────┘
```

## How it works

There is no database. **The folders in your projects root are the projects** — the app's entire
registry is a directory listing. That is why the whole product is two moving parts:

- **The server** — Node/Fastify. It owns the filesystem, the shell and the Agent SDK. It binds
  `127.0.0.1:3001` by default.
- **The client** — React/Vite. In development it is a second process on `localhost:5173` and proxies
  `/api` and `/ws` to the server. In production there is no second process: the server serves the
  built client itself, so one port is the whole app.

Either way **the browser only ever talks to one origin**, which is what makes the rest simple: no CORS
to configure, and the session cookie rides the API calls and both WebSocket upgrades alike because
they are same-origin.

```text
development:   browser ──> :5173 Vite ──proxy──> :3001 server ──> projects root
production:    browser ──────────────> :3001 server ──> projects root   (serves the built client)
```

## Requirements

| What | Why | Check |
|---|---|---|
| **Node ≥ 22.12** | npm workspaces; the server runs under `tsx` in dev and plain `node` in production. npm comes with it. | `node --version` |
| **A directory to hold your projects** | The app keeps no database: the folders in it *are* the projects. Any path the server's user can write to. | — |
| **An Anthropic API key** — one feature only | The **chat answer** comes from the Claude Agent SDK, which reads `ANTHROPIC_API_KEY` from the server's environment. Login, the terminal, the file drawer and session history all work without one, and `npm run dev:fake` stands in for offline UI work. | — |

Per platform, for a **native install** (the Docker image brings its own):

| Platform | Extra prerequisites |
|---|---|
| **Linux** | `python3`, `make`, `g++` — `npm install` compiles one native module (`node-pty`, the terminal's pty). `apt-get install -y python3 make g++` |
| **macOS** | None. `node-pty` has a prebuilt binary. |
| **Windows** | None. `node-pty` has a prebuilt binary; the terminal runs PowerShell under ConPTY. |

Nothing else: no database, no global tooling.

## Quickstart

Two processes, one browser tab, on the machine you are sitting at. Four steps to a signed-in browser,
and two more you can take later.

### 1. Install

```sh
git clone <this repo> clodeck      # if you have not already
cd clodeck
npm install
```

That installs all three workspaces (`shared`, `server`, `web`) and wires the repo's pre-commit hook.
On Linux it also compiles `node-pty` — see [Requirements](#requirements) for the toolchain it needs.

### 2. Make a projects root

Each immediate child directory of this path is one project; the app never looks deeper. The root
itself has to exist — a missing root is not an error, but it is an empty list, and the sidebar's
create button has nowhere to write.

```sh
mkdir -p ~/clodeck-projects/hello            # macOS, Linux, Git Bash
```
```powershell
mkdir $HOME\clodeck-projects\hello           # Windows PowerShell
```
```cmd
mkdir "%USERPROFILE%\clodeck-projects\hello"  rem  Windows CMD
```

### 3. Start it

Two environment variables decide everything. They are read by the **server**, so they go in front of
`npm run dev`, whose environment is passed on. Pick your shell:

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
  same variable, so the two halves move together. See [Troubleshooting](#troubleshooting) if 3001 is
  taken.

### 4. Open it, and sign in

Two lines tell you both halves came up — the server's, then the client's:

```text
clodeck server listening on http://127.0.0.1:3001
```

…and, from Vite, a `Local: http://localhost:5173/` line. Open <http://localhost:5173>, type the
password you set, and the workspace appears.

The rail's three buttons are one choice: `Chat` gives the stage back, `Terminal` and `Files` open the
one drawer below it, for the selected project. Nothing shows until a project is selected. Port 3001 is
the API in this mode, not a page — the client at 5173 is the only thing to open.

Stop everything with `Ctrl-C` in that shell; both processes go down together.

### 5. Optional: run the built client instead of Vite

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
so pass an absolute path when in doubt. This, not the dev loop, is what you deploy.

### 6. Optional: run without an API key

```sh
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm run dev:fake
```

The server then answers from a scripted fake Agent SDK provider: the whole chat surface — streaming,
tool cards, the approval modal, history and resume — is exercisable offline, and every other surface is
the real one. It still needs `UI_PASSWORD`: the gate is installed exactly the same way. Use it for UI
work, and for a first look at the app before wiring a key.

## Run it on a server

The point of Clodeck is that it runs *where the projects are*: a dedicated machine that holds the
folders, reachable from whatever browser you happen to be at. Same app, same two environment
variables — the difference is only in how the browser gets to it.

| Your situation | Do this |
|---|---|
| Trying it out, or developing | [Quickstart](#quickstart) on your own machine |
| A server, no domain, just you | [Linux](#linux-server) / [Windows](#windows-server) / [Docker](#docker), bound to loopback, plus an [SSH tunnel](#the-ssh-tunnel) |
| A server with a domain you own | [Docker Compose with a domain](#docker-compose-with-a-domain) — real HTTPS from any browser |
| A server behind your own proxy | Bind the app to `127.0.0.1:3001` and terminate TLS in that proxy |

### The one rule: HTTPS, or localhost

**The session cookie is `Secure`, and browsers only keep a `Secure` cookie on an HTTPS origin or on
`localhost`.** That is deliberate (see [Security](#security)) and it has one consequence worth
internalising before you pick a way in:

> Reaching the app at `http://<server-ip>:5173` or `http://<server-ip>:3001` gets you a login screen
> that **accepts the password and bounces straight back to itself.** The server logs a successful
> login; the browser silently discarded the cookie.

So there are exactly two ways in, and both work:

1. **An SSH tunnel**, which puts the app on `http://localhost:…` of your own machine — the one
   plain-HTTP address a browser treats as trustworthy. Nothing to configure on the server, nothing
   exposed to the network. See [The SSH tunnel](#the-ssh-tunnel).
2. **A real HTTPS origin** — a domain and a certificate, which is what Caddy does for you in
   [Docker Compose with a domain](#docker-compose-with-a-domain).

The full explanation, with the DevTools and `curl` evidence, is in
[Why a plain-HTTP address cannot hold a login](#why-a-plain-http-address-cannot-hold-a-login).

### Linux server

Tested on Debian/Ubuntu. Any distro with Node 22 works.

**Prerequisites**

```sh
# Node 22 (NodeSource). Alternatives: nvm, or your distro's package if it is 22+.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# git, and the toolchain node-pty compiles against
sudo apt-get install -y git python3 make g++
```

Then **run it as a dedicated user, not as root** — the terminal panel is a real shell, and it runs
with the server's privileges (see [Security](#security)).

```sh
sudo useradd --create-home --shell /bin/bash clodeck
sudo mkdir -p /srv/clodeck-projects && sudo chown clodeck:clodeck /srv/clodeck-projects
```

**Install and run**

```sh
sudo -u clodeck -i
git clone <this repo> /home/clodeck/clodeck && cd /home/clodeck/clodeck
npm ci                 # ci, not install: this is a deployment, and the lock file is the contract
npm run build

# the password in a file rather than an environment variable
mkdir -p ~/.config/clodeck && (umask 077; printf 'a-long-password' > ~/.config/clodeck/password)

PROJECTS_ROOT=/srv/clodeck-projects \
WEB_ROOT=/home/clodeck/clodeck/web/dist \
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password \
ANTHROPIC_API_KEY=sk-ant-... \
  npm start --workspace @clodeck/server
```

(The key is inline here for brevity; the systemd unit below keeps it in a root-owned file instead.)

`clodeck server listening on http://127.0.0.1:3001` and `curl http://127.0.0.1:3001/healthz` →
`{"status":"ok"}` mean it is up. The bind address stays loopback: the tunnel reaches it, the network
does not. Then open [The SSH tunnel](#the-ssh-tunnel) and point it at **3001**.

**Keep it running — a systemd unit**

```ini
# /etc/systemd/system/clodeck.service
[Unit]
Description=Clodeck
After=network.target

[Service]
Type=simple
User=clodeck
WorkingDirectory=/home/clodeck/clodeck/server
ExecStart=/usr/bin/node dist/main.js
EnvironmentFile=/etc/clodeck/clodeck.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
# /etc/clodeck/clodeck.env — chmod 600, root-owned
PROJECTS_ROOT=/srv/clodeck-projects
WEB_ROOT=/home/clodeck/clodeck/web/dist
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password
ANTHROPIC_API_KEY=sk-ant-...
```

```sh
sudo chmod 600 /etc/clodeck/clodeck.env
sudo systemctl daemon-reload && sudo systemctl enable --now clodeck
sudo journalctl -u clodeck -f
```

`WorkingDirectory` is load-bearing twice over: `dist/main.js` resolves against it, and so does
`clodeck.config.json` (see [Configuration](#configuration)).

### Windows server

The app runs on Windows unmodified: no compiler is needed (`node-pty` ships a prebuilt binary), and
the terminal drawer opens PowerShell rather than bash.

**Prerequisites**

```powershell
# Node 22 — winget, or the installer from nodejs.org
winget install OpenJS.NodeJS.LTS
node --version      # must be 22.12 or newer

# Optional, and only if you want to reach it over SSH from another machine —
# Windows ships the client, and the server is one optional feature:
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

**Install and run**

```powershell
git clone <this repo> $HOME\clodeck
cd $HOME\clodeck
npm ci
npm run build

$env:PROJECTS_ROOT = "D:\projects"
$env:WEB_ROOT = "$HOME\clodeck\web\dist"
$env:UI_PASSWORD = "a-long-password"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm start --workspace @clodeck/server
```

Open [The SSH tunnel](#the-ssh-tunnel) and point it at **3001**.

Two Windows notes:

- **Do not open a firewall rule for this.** Binding `HOST=0.0.0.0` to serve other machines directly
  would not work anyway — that is the plain-HTTP case in
  [The one rule](#the-one-rule-https-or-localhost), which cannot hold a login. The tunnel is the way
  in, and it needs no inbound port.
- **The command above is a foreground process.** For a service, run it under
  [NSSM](https://nssm.cc) or a Scheduled Task at startup, or take the
  [Docker](#docker) route on a Linux host and keep the Windows box as the client.

### Docker

The image is the whole product — production dependencies plus the three `dist/` trees, running as the
image's unprivileged `node` user. The server serves the built client, so there is no Vite and no
second process.

```sh
docker build -t clodeck .
```

**No domain? Run it on loopback and tunnel to it.** This is the shortest path to a working server:

```sh
# /etc/clodeck/clodeck.env — chmod 600
#   PROJECTS_ROOT=/projects
#   UI_PASSWORD=a-long-password
#   ANTHROPIC_API_KEY=sk-ant-...

docker run -d --name clodeck --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  --env-file /etc/clodeck/clodeck.env \
  -v /srv/clodeck-projects:/projects \
  -v clodeck-sessions:/home/node/.claude \
  clodeck
```

- **`-p 127.0.0.1:3001:3001`** publishes to the host's loopback only. The tunnel reaches it; the
  internet does not. Drop the `127.0.0.1:` and you have exposed the app to the network — where the
  `Secure` cookie will then stop you signing in anyway.
- **`-v /srv/clodeck-projects:/projects`** is where the projects *are*. The container runs as uid
  1000, so that directory has to be writable by it: `sudo chown -R 1000:1000 /srv/clodeck-projects`.
  Read-only is enough for browsing, and not enough for creating a project, uploading a file or letting
  the agent edit anything.
- **`-v clodeck-sessions:/home/node/.claude`** is the Agent SDK's transcript store — chat history
  survives a container restart. It is deliberately *not* the host user's own `~/.claude`.
- **`--env-file`** keeps the values out of your shell history. They are still visible to
  `docker inspect`; for the stricter shape, mount a file and use `UI_PASSWORD_FILE` instead — that is
  what the compose deployment below does.

`curl http://127.0.0.1:3001/healthz` → `{"status":"ok"}` means it is up. Then
[The SSH tunnel](#the-ssh-tunnel), pointed at **3001**.

### Docker Compose with a domain

The full deployment: the app, plus Caddy in front of it terminating TLS. Caddy is the only service
with published ports, so the app is reachable on the compose network and nowhere else.

**You need:** a domain whose A record points at this host, and **ports 80 and 443 reachable from the
internet** — the certificate is obtained and renewed automatically (Let's Encrypt). There is no cert
file to manage.

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

`docker compose` reads `.env` from this directory automatically, so `docker compose up -d` is the
whole happy path. Then `curl https://$CLODECK_DOMAIN/healthz` answers `{"status":"ok"}`, and
`https://$CLODECK_DOMAIN` is the login screen; sign in with the contents of the password file.

| Variable | What it is |
|---|---|
| `CLODECK_DOMAIN` | The public hostname. It is Caddy's site address and the name on the certificate, so it must resolve to this host. Required — compose refuses to start without it. |
| `PROJECTS_ROOT` | The **host** directory whose immediate child directories are the projects. Bind-mounted at `/projects` inside the app. Same uid 1000 ownership rule as above. Required. |
| `ANTHROPIC_API_KEY` | Read by the Agent SDK from the app's environment. Compose **requires** it, but the app boots either way: a wrong key fails at the first chat turn, and the login screen, the terminal and the file drawer work regardless. |
| `UI_PASSWORD_FILE` | A file whose trimmed contents are the login password. Compose mounts it at `/run/secrets/ui_password`; the password is never an environment variable (it would show up in `docker inspect`) and never an image layer. Defaults to `./secrets/ui_password.txt`. |

Three volumes keep state across restarts: `claude-data` (the Agent SDK's transcript store, at
`/home/node/.claude`), and `caddy-data` / `caddy-config` (the issued certificates and the ACME account
key — losing them means re-obtaining every certificate on the next start).

Only what the app needs is in the image: production dependencies and the three `dist/` trees.
`node-pty`'s Linux binding is compiled during the build — the tarball ships prebuilds for macOS and
Windows only — which is why the dependency stage carries a toolchain and the shipped image does not.
Everything is Debian (glibc) because the SDK ships a native `claude` binary; the container runs with
`init: true` so `docker compose stop` delivers a real `SIGTERM`.

**If you already run a reverse proxy**, skip this compose file: publish the app on the proxy's network
(`127.0.0.1:3001:3001`) and terminate TLS in front of it. Nothing in the app requires Caddy.

### Day-to-day with the containers

| Task | Command |
|---|---|
| Logs | `docker compose logs -f app` — or `docker logs -f clodeck` for a standalone container |
| Health | `curl -s http://127.0.0.1:3001/healthz`; compose also healthchecks the app and Caddy every 30s |
| Update | `git pull && docker compose up -d --build` (compose) or `docker build -t clodeck . && docker rm -f clodeck && docker run …` again |
| Restart | `docker compose restart app` — but note a restart **drops every session**: session ids live in the server's memory, so you log in again |
| Change the password | Edit `secrets/ui_password.txt`, then `docker compose up -d` to recreate the container. The new password is hashed at boot. |
| Back up chat history | The transcripts are in the `claude-data` volume (`/home/node/.claude`): `docker run --rm -v clodeck_claude-data:/from -v "$PWD:/to" alpine tar czf /to/claude-data.tgz -C /from .` — compose prefixes the volume with the project's directory name, so check `docker volume ls` for the real one |

## Reaching it from another machine

### The SSH tunnel

A tunnel makes the app appear on your own `localhost`, which is the one plain-HTTP origin browsers
treat as trustworthy — so this is the simplest way in, and the only one that needs nothing on the
server side.

| What you are running on the server | Tunnel | Open |
|---|---|---|
| `npm run dev` (the dev loop) | `5173` | <http://localhost:5173> |
| `npm start` with `WEB_ROOT`, or Docker | `3001` | <http://localhost:3001> |

```sh
# macOS / Linux, and Windows PowerShell or Windows Terminal — OpenSSH is built in
ssh -N -L 3001:127.0.0.1:3001 clodeck@your-server

# the dev loop instead of the built client
ssh -N -L 5173:127.0.0.1:5173 clodeck@your-server

# both at once, if you are switching between them
ssh -N -L 3001:127.0.0.1:3001 -L 5173:127.0.0.1:5173 clodeck@your-server
```

`-N` means "no remote shell — just forward the port"; the command sits there while the tunnel is open,
and `Ctrl-C` closes it. Then open the URL in the table above. Notes:

- **Windows clients need nothing installed** — `ssh` is part of Windows 10+. A non-default port is
  `-p 2222`, and a key is `-i $HOME\.ssh\id_ed25519`. In CMD, use the same command; only the env-var
  syntax elsewhere in this README differs between shells.
- **No `--host 0.0.0.0` anywhere.** Vite binds `localhost` by default, which is exactly what the tunnel
  reaches. Opening the dev server to the network buys nothing — the `Secure` cookie blocks the login
  anyway (see below) — and puts a dev server with no auth of its own on a public port.
- **`clodeck@` is whichever account owns the install** — `clodeck` for the systemd setup above,
  `root@` if you installed under root. The user matters only for reaching the files.
- **The tunnel survives a laptop sleep only if you tell it to**: add `-o ServerAliveInterval=30
  -o ServerAliveCountMax=3`, or run it under `autossh -M 0`.
- **Leaving it open is fine.** A tunnel binds your own loopback; it is not an open port, and it stops
  the moment you close it.

### Why a plain-HTTP address cannot hold a login

If you point a browser at the server by IP over HTTP — `http://203.0.113.10:5173`, with Vite started
`--host 0.0.0.0` — you get a specific, confusing failure. Type the password and the screen flickers
and stays on the sign-in form. No error message, no failed login in the server's log. Quite the
opposite: the server logs a *successful* login. DevTools shows it plainly:

```http
POST http://203.0.113.10:5173/api/auth/login   →  200
GET  http://203.0.113.10:5173/api/auth/me      →  401
```

The cause is one line of the login response. Every session cookie is set with `Secure`
(`server/src/auth/transport.ts`):

```http
Set-Cookie: clodeck_session=…; HttpOnly; Secure; SameSite=Strict; Max-Age=…
```

A browser accepts a `Secure` cookie **only** from an HTTPS origin, or from `localhost` / `127.0.0.1`
/ `[::1]` — which are special-cased as trustworthy. `http://203.0.113.10:5173` is neither, so the
browser throws the `Set-Cookie` away. The next request carries no cookie, the auth gate answers 401,
and the client — which reads the principal from `/api/auth/me` rather than assuming one — returns you
to the sign-in screen. Chrome says it out loud in the Console:

```text
This Set-Cookie was blocked because it had the "Secure" attribute but was not received over a secure connection.
```

You can watch the server do everything right, cookie and all, from a shell that has no such rule:

```sh
curl -i -X POST http://203.0.113.10:5173/api/auth/login \
  -H 'content-type: application/json' -d '{"password":"a-long-password"}'
# 200, and a Set-Cookie line with Secure on it
```

**The fix is not to weaken the cookie.** Use the [SSH tunnel](#the-ssh-tunnel) and open
`http://localhost:3001`, or put the app behind HTTPS with
[Docker Compose with a domain](#docker-compose-with-a-domain). Two workarounds exist and are worth
knowing only so you can recognise them as workarounds: a browser flag
(`chrome --unsafely-treat-insecure-origin-as-secure=http://203.0.113.10:5173 --user-data-dir=/tmp/clodeck`,
temporary and per-machine), and `tls internal` in Caddy, which issues a certificate no browser trusts
until you install its root CA. Neither is worth it when the tunnel is one command.

## Configuration

Read by the **server** in every case; the client bakes in nothing but relative URLs.

| Variable | Default | Meaning |
|---|---|---|
| `PROJECTS_ROOT` | — | The directory whose immediate child directories are the projects. Unset or empty → an empty list, never an error. |
| `UI_PASSWORD` | — | The single account's password. Unset or empty → the server boots **fail-closed**: every route and socket answers 401 and no login can succeed. |
| `UI_PASSWORD_FILE` | — | Read **only** when `UI_PASSWORD` is unset: a file whose trimmed contents are the password (the Docker-secret shape). |
| `PORT` | `3001` | The server's port. The Vite dev proxy targets the same value, so `PORT=3300 npm run dev` moves both halves together. |
| `HOST` | `127.0.0.1` | The server's bind address. Loopback by default as defense in depth — the auth gate, not the bind address, is what keeps the surface closed. A container sets `0.0.0.0` because its loopback reaches nobody. |
| `WEB_ROOT` | — | The built client's directory. Unset → the server serves no client at all, which is what the Vite dev loop wants. Set → the server serves the SPA at `/`, auth-exempt, with an `index.html` fallback for deep links, and `npm run build && npm start` is the whole app. |
| `ANTHROPIC_API_KEY` | — | Read by the Agent SDK from the server's environment; the server itself never reads, stores or forwards it. Only the real provider needs it — `npm run dev:fake` needs none. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where the Agent SDK keeps its transcripts — the thing session history and resume are read from. The Docker image sets `/home/node/.claude` and mounts a volume there. |

**`clodeck.config.json`** is the fallback for deployments that would rather not export an environment
variable. It is read from the server's working directory — which is `server/`, not the repo root, when
the root scripts run it, because npm runs a workspace script there:

```json
{ "projectsRoot": "/srv/projects" }
```

## Commands

Every command runs from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces. `npm ci` for a deployment. |
| `npm run dev` | Builds `shared`, then runs the server (`tsx watch` — reloads on change) and the web client (Vite dev server) together. |
| `npm run dev:fake` | The same, but the server runs the scripted fake Agent SDK provider instead of the real one — the whole chat surface with no API key and no network. It still needs `UI_PASSWORD`: the gate is installed the same way, so an unset password is fail-closed here too. |
| `npm run build` | Builds `shared` → `server` → `web` into each package's `dist/`. |
| `npm start --workspace @clodeck/server` | Runs the built server. With `WEB_ROOT` set, it serves the client too. |
| `npm test` | Builds `shared`, then runs the whole Vitest suite across all packages. |
| `npm run typecheck` | Type-checks every package (`tsc` with `noEmit` — nothing is written). |
| `npm run e2e` | Runs the Playwright suite in `web/e2e/` against a dev loop that is already up (see [Development](#development)). |

`dev`, `test`, `build` and `typecheck` all build `shared` first, because `server` and `web` resolve it
through its built `exports` (`shared/dist`) — a clean clone has nothing to import until that happens.
For the same reason, editing `shared/` while `npm run dev` is running needs a `npm run build:shared`
(or a restart) before the server and the client see the change.

## Troubleshooting

Every entry here is a symptom someone actually hit. Start with the server's first lines of output —
its warnings name their own fix.

### I sign in and land back on the sign-in screen

**The signature of the `Secure` cookie over plain HTTP.** The browser reached the app at an
`http://` address that is not `localhost`, accepted the login, discarded the session cookie, and was
answered `401` by the next call. Nothing is wrong with the server, and no amount of reading its log
will show it — it logs the login as a success.

Open DevTools → Network and look for `POST /api/auth/login → 200` followed by
`GET /api/auth/me → 401` (the Console also reports the blocked cookie). Then:

- **Reaching a server by IP?** Use an [SSH tunnel](#the-ssh-tunnel) and open
  `http://localhost:3001`. This is the fix, not a workaround.
- **Just started it locally?** You are on `http://localhost:5173` — check that the host in the address
  bar really says `localhost` or `127.0.0.1`, not the machine's LAN IP from the `Network:` line Vite
  prints next to `Local:`. That line is for other devices, and the cookie rule is exactly why it does
  not work for them.
- The full mechanism is in
  [Why a plain-HTTP address cannot hold a login](#why-a-plain-http-address-cannot-hold-a-login).

### The client answers 502 for everything

A 502 from the client is the **proxy** failing, not the app: Vite could not reach the backend, and the
backend's own log says nothing at all — because it never started. On Windows the usual cause is that
the OS is holding the port:

```text
Error: listen EACCES: permission denied 127.0.0.1:3001
```

Hyper-V and WSL reserve themselves dynamic port ranges at boot — `2980–3079` on the machine where this
was first hit, which contains 3001 — and everything inside them is unbindable. See them with:

```sh
netsh interface ipv4 show excludedportrange protocol=tcp
```

Two ways out. Move the port (`PORT=3300 npm run dev` — the proxy follows it), or hand the ranges back
for this boot with an **elevated** shell:

```sh
net stop winnat && net start winnat
```

Nothing about the app is wrong in either case: no code change, no config change, and no amount of
reading the server's log will show it. On Linux the same 502 means `EADDRINUSE` — something else is on
3001 — and `PORT` moves it just the same. Vite's own port moves too if 5173 is taken: read the `Local:`
line it prints rather than assuming.

### The sidebar is empty, though the folder has directories in it

`PROJECTS_ROOT` did not reach the server as the path you meant — and that failure is quiet by design,
because the server's answer to a root it cannot use is an empty list, never an error. The tell is its
warn line, and it says which of the two happened: `no projects root configured — …` when nothing
arrived at all, and `could not read projects root <path>: …` when something arrived that is not a
readable directory. Three traps:

- **Git Bash on Windows eats the backslashes** in `PROJECTS_ROOT=D:\work\projects`: the server then
  scans `D:workprojects` and finds nothing. Use forward slashes (`/d/work/projects`).
- **Only immediate child directories are projects.** One level deeper is not listed; a plain file or a
  dot-directory (`.git`, `.cache`) is not either. A symlink counts, but only if what it points at is
  inside the root.
- **In Docker, `PROJECTS_ROOT` is the path *inside* the container** (`/projects`), and the host
  directory arrives through `-v`. Setting it to the host path inside the container finds nothing.

### The app cannot write to the projects directory

Reading works, creating or saving fails. The container — and the image — runs as uid 1000 (`node`), so
the bind-mounted projects directory must be writable by that uid:

```sh
sudo chown -R 1000:1000 /srv/clodeck-projects
```

On a native install the equivalent mistake is running the server as one user while the projects belong
to another. See also [Security](#security) — running it as root is not the fix, it is a bigger problem.

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
all work and the turn fails; `npm run dev:fake` is the offline stand-in, and a *wrong* key fails at the
first turn with the SDK's own error in the chat.

### npm install fails on Linux

`node-pty` has no prebuilt Linux binary, so its install script compiles one and needs a toolchain.
The failure names a missing `python3`, `make` or `g++` (`gyp ERR! find Python`, `gyp ERR! stack Error:
not found: make`):

```sh
sudo apt-get install -y python3 make g++
```

The [Docker](#docker) path never sees this: the image builds the binding in a stage that has the
toolchain, and copies the result into an image that does not.

## Security

One account, password only, meant to be reachable from the internet — so a couple of rules are
deliberate rather than incidental.

**The login.** `POST /api/auth/login` checks the password against a salted **scrypt** hash (built from
`UI_PASSWORD` at boot; the plaintext is never kept), and sets an `HttpOnly; Secure; SameSite=Strict`
session cookie. Every `/api/**` route plus both `/ws` and `/ws/terminal` require it — `/healthz` and
the two auth routes are the only exemptions. Logins are rate-limited per address (five failures lock
it out for fifteen minutes, and the lock is checked before the password so a locked address cannot burn
scrypt cycles). Session ids live server-side, so a logout or a restart invalidates them. A WebSocket
upgrade is refused when its `Origin` is not the host it was sent to.

`Secure` is always on, with no off-switch: browsers exempt `localhost`, so the dev loop is unaffected,
and anything else has to be HTTPS. That is the rule in
[The one rule](#the-one-rule-https-or-localhost), and it is why the tunnel is the recommended way in.

**What the app can touch.** Everything below is enforced, not documented intent:

- **The projects root is the whole world.** Every path from the file drawer and the file API is
  re-validated by `realpath` containment, so a symlink cannot lead out of the root, and the root itself
  can never be touched.
- **Writes never follow a symlink in the target's final segment**, and never overwrite an existing file
  on create, upload or move. The save route is the one deliberate overwrite, and it refuses a non-file
  target.
- **The terminal is a real shell**, running as whatever user started the server — the same privileges,
  no sandbox. Run Clodeck as a dedicated unprivileged user ([Linux server](#linux-server) shows the
  account), or use the [Docker](#docker) image, which already runs as `node`.

**Secrets.** The compose deployment keeps the password in a mounted file rather than an environment
variable, so it stays out of `docker inspect`. The Agent SDK reads `ANTHROPIC_API_KEY` from the
process environment; the server itself never reads, stores or forwards it.

## Architecture

Three npm workspaces, scoped `@clodeck/*`:

| Package | What it owns |
|---|---|
| [`shared/`](shared) | `@clodeck/shared` — the domain types (`Project`, `Principal`) and the transport contracts (the event/message envelopes, the Agent SDK message mirror). Both other packages import it, so a contract change breaks compilation on both sides at once. |
| [`server/`](server) | `@clodeck/server` — the Node/Fastify backend: project discovery over the filesystem, the Agent SDK behind a provider facade, the session bus at `/ws`, the terminal at `/ws/terminal`, the scoped file access, and the auth gate over all of it. |
| [`web/`](web) | `@clodeck/web` — the React + Vite + Tailwind client: the login screen, the project switcher, the streaming chat surface, the xterm.js terminal and the file drawer. |

A request path, end to end: the client calls same-origin `/api/...` (through Vite's proxy in dev,
directly in production) → the auth gate reads the session cookie and either attaches a principal or
answers `401` → the route handler. WebSocket upgrades take the same gate, plus an `Origin` check,
before a socket exists.

## Development

- **The pre-commit hook is the only automatic check this repo has** (there is no CI). `npm install`
  wires it — `.githooks/pre-commit`, through `core.hooksPath` — and it runs `npm run typecheck` and
  `npm test`, so a red tree is never committed. `git commit --no-verify` skips it once. If it never
  seems to fire, `git config core.hooksPath` should answer `.githooks`; `npm run prepare` sets it.
- **Two traps are load-bearing, and both are commented where they live** so the next person does not
  "fix" them back:
  - `npm run dev` passes `--raw` to `concurrently` on purpose. Without it, `concurrently`'s
    line-prefixing streams deadlock the *real* Agent SDK's import under `tsx watch`: the server starts,
    prints nothing, never listens, and the client's proxy answers 502. `dev:fake` never imports the
    SDK, so it keeps the prefixes.
  - The Playwright config drives the machine's **installed Chrome** (`channel: 'chrome'`), because
    `npx playwright install chromium` fails on this network with `Failed to download Chrome for
    Testing`.
- **End-to-end tests need a running app and a browser**, which is why they are not part of `npm test`:

  ```sh
  UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects PORT=3300 npm run dev   # one shell
  UI_PASSWORD=dev npm run e2e                                              # another
  ```

  The dev server must be on <http://localhost:5173>, and the server must be hashed against the same
  `UI_PASSWORD` the suite sends, because it logs in like a person does.

- **One commit per coherent change, never on `main`** — this repo's conventions, including the branch
  naming and the local issue tracker, are in [`AGENTS.md`](AGENTS.md).

## Docs

- [`AGENTS.md`](AGENTS.md) — working conventions for this repo: language, git flow, and how the local
  issue tracker is laid out.
- [`.scratch/clodeck/`](.scratch/clodeck) — the current build effort: spec, tickets, handoff.
- [`.scratch/web-claude-ui/`](.scratch/web-claude-ui) — the wayfinder spec and the verified visual
  prototype the UI follows.
