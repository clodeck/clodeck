# Clodeck

**Remote browser access to Claude Code across multiple project directories.**

Clodeck is a web UI over the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).
One project is one directory: one agent session, one shell, one file drawer. The app runs on a server
you own — the same machine the project folders live on — and you drive it from any browser, on any
machine. One user, one password.

**Status: the MVP's four surfaces are built.** Project discovery, the project switcher, creating a
project from the sidebar (`POST /api/projects`), and deleting one (`DELETE /api/projects/:id`) behind a
typed-name confirmation work end to end. So does the chat surface: streaming
Agent SDK turns over a WebSocket bus at `/ws`, tool cards, the approval modal, and session history /
resume over REST. So does the terminal: a per-project shell (node-pty behind a facade) streamed as raw
bytes over `/ws/terminal` into an xterm.js panel. So does the file drawer: a tree that expands in
place, with create / rename / delete / upload, and an editable preview that saves back to disk — all
scoped to the project root. Auth fronts every one of them. And each chat session runs on a **provider
profile** you pick beside the composer — the server's own environment, or any
`CLODECK_PROVIDER_<NAME>_*` the operator declared ([Provider profiles](#provider-profiles)).

**Where to start:** [Quickstart](#quickstart) goes from a clean clone to a signed-in browser on your
own machine. [Run it on a server](#run-it-on-a-server) is the same thing for a Linux box, a Windows
box, or Docker. Stuck? [Troubleshooting](#troubleshooting).

## Contents

- [What you get](#what-you-get)
- [Deleting a project](#deleting-a-project)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Run it on a server](#run-it-on-a-server)
  - [The direct route](#the-direct-route)
  - [Linux server](#linux-server)
  - [Windows server](#windows-server)
  - [Docker](#docker)
  - [Docker Compose with a domain](#docker-compose-with-a-domain)
  - [Day-to-day with the containers](#day-to-day-with-the-containers)
- [Reaching it from another machine](#reaching-it-from-another-machine)
  - [The SSH tunnel](#the-ssh-tunnel)
  - [The encrypted alternative: Caddy's internal certificate](#the-encrypted-alternative-caddys-internal-certificate)
  - [When the origin is not declared](#when-the-origin-is-not-declared)
- [Configuration](#configuration)
- [Provider profiles](#provider-profiles)
- [Permission modes](#permission-modes)
  - [Bypass](#bypass)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Architecture](#architecture)
- [Development](#development)
- [Publishing and CI/CD](#publishing-and-cicd)
  - [The branch model](#the-branch-model)
  - [The checks](#the-checks)
  - [Deploying to production](#deploying-to-production)
  - [One-time setup](#one-time-setup)
  - [Rollback](#rollback)
- [Docs](#docs)

## What you get

| Surface | What it does |
|---|---|
| **Projects** | The sidebar lists the immediate child directories of `PROJECTS_ROOT`. Select one and its chat takes the stage. `New project` creates one for real — a `mkdir` under the root, nothing else. A row's `⋯` menu holds `Delete…`, which removes the directory for real — recursively, with no trash and no undo — after you type its name ([Deleting a project](#deleting-a-project)). |
| **Chat** | One Agent SDK session per project: streamed turns, tool cards, an approval modal when the agent asks, session history you can resume — and two pickers beside the composer: the provider each session runs on, and the permission mode it runs under. |
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

## Deleting a project

A project row's `⋯` menu — revealed on hover, and a deliberate tap on a phone — holds one item,
`Delete…`. Neither opening the menu nor selecting the row commits to anything: the dialog asks you to
type the project's exact **name** (case-sensitive), shows the canonical path that will leave the disk,
and says it cannot be undone. `Cancel` is always there, and the confirm button stays dead until the name
matches.

**It is a real delete.** The directory is removed **recursively** — every file and subdirectory inside
it. There is no trash directory and no undo, and nothing is hidden in a registry: `deleted` means the
directory is gone. If the working tree matters, copy it off the server first. The route behind the
sidebar is `DELETE /api/projects/:id`, behind the same login as every other `/api` route; it answers
`204` on success and one of the refusals below on anything else.

**A live turn or an attached terminal refuses it, with `409`.** A running turn answers
`turn_in_progress`; a terminal the server still holds answers `terminal_attached`. clodeck does not stop
either on your behalf — a `409` kills nothing. Press **Interrupt** in the chat, or close the terminal
(switch the drawer to Files, or press its `✕`), then delete again. The dialog stays open with the
server's sentence either way.

**A project reached through a symlink is refused**, with `400 symlink`, and so is an id that more than
one root entry names. The list deduplicates by canonical path, so a link `alpha → zulu` can be the row
shown for `zulu`'s id; deleting by that id would destroy `zulu` while the label said `alpha`, and
unlinking the link would leave every file in place and make "deleted" a lie. A project is therefore
deletable only when exactly one root entry is the real directory itself — never a link. The projects
root is never a target either: it is not an immediate child, so an id that resolves to it is a `404`.

**The SDK's transcripts stay where they are.** Session history lives under the SDK's own directory,
`~/.claude/projects/<sanitized path>/` by default (`CLAUDE_CONFIG_DIR`), not inside the project.
Deleting the project does not touch it, and clodeck never purges it — a project delete is the one place
clodeck destroys data, and it stays inside the projects root. A deleted project's disk is therefore
**not** fully freed: its conversations remain under `CLAUDE_CONFIG_DIR` until you remove them yourself.

**A project re-created at the same path may still see the old sessions in History**, because that is
where those transcripts are. It does not silently continue one: the delete forgets the server's
in-memory run entry for that id (the id is the canonical path, so the re-created project gets the same
one), so the first send starts a new session. **Resume stays a button you press** — the old history is
reachable, but only by asking for it.

On success the sidebar reloads and shows `deleted <name>`; if the deleted project was the selected one,
the stage goes back to its no-project empty state rather than jumping to a neighbour.

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
then two more: step 5 is how the app is deployed, and step 6 runs it without an API key.

**Prefer to be walked through it?** `bash scripts/setup-clodeck.sh` asks for each value, writes them
down, and starts nothing until you say so — see [Or let the wizard do it](#or-let-the-wizard-do-it).

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

#### …or let `.env` do it

Once `scripts/setup-clodeck.sh` has been run, those values — and everything else it asked for — are in
`.env`. `npm run dev:env` is the same loop with that file loaded:

```sh
npm run dev:env                  # npm run dev, with .env in front of it
npm run dev:env -- dev:fake      # …or with any other script in front
```

Both commands are worth having. `npm run dev` reads no file at all: it is the loop with nothing in front
of it, which is what you want when the variables are already exported. `.env` is what the wizard leaves
behind, and nothing reads it for you unless you ask — which fails loudly for the two variables above and
**silently for the credential**. A missing `UI_PASSWORD` refuses every login and a missing
`PROJECTS_ROOT` is an empty project list, both from the first screen. A missing `ANTHROPIC_API_KEY` — or
a base URL and token that never left the file — looks exactly like a working app until the first chat
turn, which answers `Not logged in · Please run /login`
([Troubleshooting](#everything-works-except-the-chats-answer)).

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

### 5. Run the built app — this, not the dev loop, is what you deploy

The same app, one process, no dev server. `npm run serve` is the whole deployment path: it checks the
configuration, builds all three packages, and starts the server against the client it has just built.

```sh
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm run serve
```

Then <http://127.0.0.1:3001> *is* the app — login screen, shell, everything — and there is no second
process to remember. The preflight stops before the build, in plain language, when `UI_PASSWORD` or
`PROJECTS_ROOT` is missing; the server logs which client directory it resolved; and the whole
`/api` and `/ws` surface behaves exactly as it does under Vite. Only the client's origin changed.
Reaching this app from another machine — or from a phone — is what `CLODECK_PUBLIC_URL` and
[the direct route](#the-direct-route) are for.

### 6. Optional: run without an API key

```sh
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm run dev:fake
```

The server then answers from a scripted fake Agent SDK provider: the whole chat surface — streaming,
tool cards, the approval modal, history and resume — is exercisable offline, and every other surface is
the real one. It still needs `UI_PASSWORD`: the gate is installed exactly the same way. Use it for UI
work, and for a first look at the app before wiring a key. `npm run dev:fake:env` is the same command
when the values came from the wizard and live in `.env`.

### Or let the wizard do it

`scripts/setup-clodeck.sh` is steps 1–6 *with* you rather than *to* you: it checks the checkout and
the Node version, asks for the projects root and the login password, walks the provider profiles
([below](#provider-profiles)), and generates a launcher. It is a bash script — on Windows that means
Git Bash, which comes with Git for Windows.

```sh
bash scripts/setup-clodeck.sh
```

It adds two things the steps above leave implicit, both because **the server reads real environment
variables and nothing else** — there is no dotenv in this repo:

- **`.env`** — every value it captured, in one place. `docker compose` reads that file by itself;
  nothing else does unless you ask it to, which is what the launcher and `npm run dev:env` are for.
- **`start-clodeck.ps1`** and **`start-clodeck.sh`** — a launcher that loads `.env` into the
  environment and runs `npm run serve`. Both are gitignored, as `.env` is: they belong to the
  machine, not to the repo.
- **`npm run dev:env`** — the other half of that door, and the one that lives in the repo rather than
  on the machine: it loads `.env` and runs `npm run dev`, so a value captured here reaches the loop a
  developer works in and not only the built app ([step 3](#3-start-it)).

Re-running it is safe. Every prompt offers the value already saved and Enter keeps it, so a second
run is how you add a tier or correct one path.

## Run it on a server

The point of Clodeck is that it runs *where the projects are*: a dedicated machine that holds the
folders, reachable from whatever browser you happen to be at. Same app, same handful of environment
variables — the difference is only in how the browser gets to it.

| Your situation | Do this |
|---|---|
| Trying it out, or developing | [Quickstart](#quickstart) on your own machine |
| A server, no domain, just you | [The direct route](#the-direct-route) — a bare `http://<ip>:<port>` origin any browser can bookmark, with the password and every session byte **in cleartext** ([Linux](#linux-server) / [Windows](#windows-server) / [Docker](#docker) show the install) |
| A server, no domain, and you want encryption | [The SSH tunnel](#the-ssh-tunnel) — nothing to install, but no phone and no bookmark — or [Caddy's internal certificate](#the-encrypted-alternative-caddys-internal-certificate) — a real `https:` origin, at the price of installing a root CA on every device |
| A server with a domain you own | [Docker Compose with a domain](#docker-compose-with-a-domain) — real HTTPS from any browser |
| A server behind your own proxy | Bind the app to `127.0.0.1:3001`, terminate TLS in that proxy, and set `CLODECK_PUBLIC_URL` to the origin the browser uses — plus `CLODECK_TRUSTED_PROXIES=127.0.0.1/8`, so the login lockout counts failures against the browser rather than against the proxy |

### The direct route

A server, a public IP and no domain is the most ordinary deployment there is, and it works. Bind the
app to the network, declare the origin a browser will type, and the session sticks — so any browser on
any device can bookmark it, with nothing installed on the client and no tunnel to hold open.

```sh
# Linux / macOS. `npm run serve` checks the config, builds, and starts (see step 5 of Quickstart).
HOST=0.0.0.0 \
CLODECK_PUBLIC_URL=http://203.0.113.10:3001 \
UI_PASSWORD='a-long-password' \
PROJECTS_ROOT=/srv/clodeck-projects \
  npm run serve
```

**`CLODECK_PUBLIC_URL` is the whole trick, and its cost belongs in the same breath: there is no TLS,
so the password, every chat message and every byte of terminal output cross the network in cleartext.**
Anyone on the path can read them. That is the trade for reaching the app from a phone with no domain,
and it is deliberately said twice — the server warns at startup, and the login screen says it where you
type the password. Declare the same origin with `https:` and the session cookie is `Secure` again,
which is what the encrypted routes are for.

**Undeclared, nothing changes.** With no `CLODECK_PUBLIC_URL` the cookie stays `Secure`, exactly as it
always was — and a bare `http://` origin then gets the bounce described in
[When the origin is not declared](#when-the-origin-is-not-declared).

If you would rather encrypt it, three routes do that:

1. **An SSH tunnel** — the app appears on `http://localhost:…` of your own machine, nothing exposed
   and nothing to configure on the server, but it takes a tunnel: no phone, no bookmark. See
   [The SSH tunnel](#the-ssh-tunnel).
2. **Caddy's internal certificate** — a real `https:` origin with no domain, at the price of
   installing Caddy's root CA on every device. See
   [the encrypted alternative](#the-encrypted-alternative-caddys-internal-certificate).
3. **A domain and Let's Encrypt** — nothing to install on any client, which is why it is the one to
   pick once you have a domain. See [Docker Compose with a domain](#docker-compose-with-a-domain).

### Linux server

Tested on Debian/Ubuntu. Any distro with Node 22 works.

**Prefer to be walked through it?** `bash scripts/deploy-clodeck.sh` is this section *with* you
rather than *to* you: it installs the prerequisites, asks for the projects root, the login password,
the endpoint and any tiers, then writes `/etc/clodeck/clodeck.env` and the systemd unit, opens the
port in the firewall, and waits for `/healthz` to answer. Re-running it is how you change a value.

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

# the password in a file rather than an environment variable
mkdir -p ~/.config/clodeck && (umask 077; printf 'a-long-password' > ~/.config/clodeck/password)

PROJECTS_ROOT=/srv/clodeck-projects \
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password \
ANTHROPIC_API_KEY=sk-ant-... \
  npm run serve
```

`npm run serve` is the deployment path: the preflight refuses to build anything until it can see a
password and a projects root, then it builds and starts the server against the client it has just
built. `WEB_ROOT` needs no value here — unset, the build that command made is found and logged.

(The key is inline here for brevity; the systemd unit below keeps it in a root-owned file instead.)

`clodeck server listening on http://127.0.0.1:3001` and `curl http://127.0.0.1:3001/healthz` →
`{"status":"ok"}` mean it is up. The bind address stays loopback: the tunnel reaches it, the network
does not. Then open [The SSH tunnel](#the-ssh-tunnel) and point it at **3001**.

To reach it from other machines directly instead — from a phone, with no tunnel to hold open — add
`HOST=0.0.0.0` and `CLODECK_PUBLIC_URL=http://<the address a browser types>:3001` to the same
environment. That is [the direct route](#the-direct-route), and it puts the password and every byte
of the session on the wire in cleartext.

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
# optional: unset, the server finds the build by walking up from its working directory, and logs it
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

$env:PROJECTS_ROOT = "D:\projects"
$env:UI_PASSWORD = "a-long-password"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm run serve
```

Open [The SSH tunnel](#the-ssh-tunnel) and point it at **3001**.

Two Windows notes:

- **Do not open a firewall rule for this.** The tunnel is the way in, and it needs no inbound port.
  Serving other machines directly is [the direct route](#the-direct-route): it works once the origin
  is declared, and it puts the password and every byte of the session on the wire in cleartext — so
  open the port when you mean it, not by accident.
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

**No domain? Run it on loopback and tunnel to it.** This is the shortest path to a working server, and
the encrypted one:

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
  internet does not. Dropping the `127.0.0.1:` is how you reach it from other machines instead — that
  is [the direct route](#the-direct-route), and it needs `CLODECK_PUBLIC_URL` in the env file, set to
  the origin the browser types, or the login will bounce ([why](#when-the-origin-is-not-declared)).
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

**Caddy's address is declared to the app**, as `CLODECK_TRUSTED_PROXIES: 172.16.0.0/12` in the compose
file — Docker's own pool, so this costs you nothing. It is what the login lockout keys on: without it
every login arrives from Caddy, and five failures from anyone would lock out the one user there is
([what the variable does](#configuration), and why, under [Security](#security)). Swapping Caddy for a
proxy on another network means changing that value — or setting it in your own compose override.

Three volumes keep state across restarts: `claude-data` (the Agent SDK's transcript store, at
`/home/node/.claude`), and `caddy-data` / `caddy-config` (the issued certificates and the ACME account
key — losing them means re-obtaining every certificate on the next start).

Only what the app needs is in the image: production dependencies and the three `dist/` trees.
`node-pty`'s Linux binding is compiled during the build — the tarball ships prebuilds for macOS and
Windows only — which is why the dependency stage carries a toolchain and the shipped image does not.
Everything is Debian (glibc) because the SDK ships a native `claude` binary; the container runs with
`init: true` so `docker compose stop` delivers a real `SIGTERM`.

**If you already run a reverse proxy**, skip this compose file: publish the app on the proxy's network
(`127.0.0.1:3001:3001`), terminate TLS in front of it, and set `CLODECK_PUBLIC_URL` to the `https:`
origin the browser uses — the one fact the app cannot see from behind a proxy. Add
`CLODECK_TRUSTED_PROXIES` for that proxy's address (`127.0.0.1/8` when it is on the host) unless you
want the login lockout to see one client where there are many. Nothing in the app requires Caddy.

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

A tunnel makes the app appear on your own `localhost`, which browsers treat as a trustworthy origin
whatever the scheme — so the session cookie stays `Secure` and SSH encrypts every byte end to end.
Nothing is exposed, and nothing on the server side needs configuring. The price is the tunnel itself:
no phone, no bookmark.

| What you are running on the server | Tunnel | Open |
|---|---|---|
| `npm run dev` (the dev loop) | `5173` | <http://localhost:5173> |
| `npm run serve`, or Docker | `3001` | <http://localhost:3001> |

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
  reaches, and opening it to the network would put a dev server with no auth of its own on a public
  port. Reaching the app from other machines is [the direct route](#the-direct-route), where the
  server serves the built client — not Vite.
- **`clodeck@` is whichever account owns the install** — `clodeck` for the systemd setup above,
  `root@` if you installed under root. The user matters only for reaching the files.
- **The tunnel survives a laptop sleep only if you tell it to**: add `-o ServerAliveInterval=30
  -o ServerAliveCountMax=3`, or run it under `autossh -M 0`.
- **Leaving it open is fine.** A tunnel binds your own loopback; it is not an open port, and it stops
  the moment you close it.

### The encrypted alternative: Caddy's internal certificate

If you want the direct route's reachability without the cleartext, and you have no domain, Caddy can
issue the certificate from its **own local authority** instead of Let's Encrypt — the
[`tls internal`](https://caddyserver.com/docs/caddyfile/directives/tls#tls) directive, one line added
to the compose stack's Caddyfile. The caveat is the whole story: no browser trusts that authority, so
every device needs its root CA **installed** before the warning goes away — Caddy's root CA lands in
the `caddy-data` volume and has to be copied onto each client. On iOS, installing the profile is only
half of it: the certificate then has to be trusted under **Settings → General → About → Certificate
Trust Settings**, and a warning clicked through is not enough. A laptop tolerates a warning; the
phone bookmark this route exists for does not.
[Docker Compose with a domain](#docker-compose-with-a-domain) stays the route with nothing to install
anywhere.

```caddyfile
# The compose Caddyfile with that one line added. The site address still needs no
# public domain — `CLODECK_DOMAIN` can be any name that resolves to this machine,
# so a LAN name in each device's hosts file is enough — and Caddy now serves it
# over HTTPS with a certificate from its own CA, asking nothing of Let's Encrypt.
{$CLODECK_DOMAIN} {
	tls internal
	reverse_proxy app:3001 {
		health_uri /healthz
		health_interval 30s
	}
}
```

### When the origin is not declared

Point a browser at the app by IP over HTTP — `http://203.0.113.10:3001`, or the dev server started
`--host 0.0.0.0` at `http://203.0.113.10:5173` — **without declaring that origin**, and you get a
specific, confusing failure. Type the password and the screen flickers and stays on the sign-in form.
No error message, no failed login in the server's log. Quite the opposite: the server logs a
*successful* login. DevTools shows it plainly:

```http
POST http://203.0.113.10:3001/api/auth/login   →  200
GET  http://203.0.113.10:3001/api/auth/me      →  401
```

The cause is one flag. With no `CLODECK_PUBLIC_URL`, the session cookie is set `Secure`
(`server/src/auth/transport.ts`):

```http
Set-Cookie: clodeck_session=…; HttpOnly; Secure; SameSite=Strict; Max-Age=…
```

A browser accepts a `Secure` cookie **only** from an HTTPS origin, or from `localhost` / `127.0.0.1`
/ `[::1]` — which are special-cased as trustworthy. `http://203.0.113.10:3001` is neither, so the
browser throws the `Set-Cookie` away. The next request carries no cookie, the auth gate answers 401,
and the client — which reads the principal from `/api/auth/me` rather than assuming one — returns you
to the sign-in screen. Chrome says it out loud in the Console:

```text
This Set-Cookie was blocked because it had the "Secure" attribute but was not received over a secure connection.
```

You can watch the server do everything right, cookie and all, from a shell that has no such rule:

```sh
curl -i -X POST http://203.0.113.10:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"password":"a-long-password"}'
# 200, and a Set-Cookie line with Secure on it
```

**The fix is to declare the origin, not to weaken the cookie.** In this exact case
`CLODECK_PUBLIC_URL=http://203.0.113.10:3001` is what makes the cookie non-`Secure` and the login
hold — that is [the direct route](#the-direct-route), cost included. Reaching the app over HTTPS
instead keeps the cookie `Secure` and drops the cost: use
[Docker Compose with a domain](#docker-compose-with-a-domain), an [SSH tunnel](#the-ssh-tunnel), or
[Caddy's internal certificate](#the-encrypted-alternative-caddys-internal-certificate). What is
*not* a fix is a browser flag that calls the origin secure
(`chrome --unsafely-treat-insecure-origin-as-secure=…`): it is per-machine, temporary, and leaves
the traffic readable to everyone else on the path.

## Configuration

Read by the **server** in every case; the client bakes in nothing but relative URLs.

| Variable | Default | Meaning |
|---|---|---|
| `PROJECTS_ROOT` | — | The directory whose immediate child directories are the projects. Unset or empty → an empty list, never an error. |
| `UI_PASSWORD` | — | The single account's password. Unset or empty → the server boots **fail-closed**: every route and socket answers 401 and no login can succeed. |
| `UI_PASSWORD_FILE` | — | Read **only** when `UI_PASSWORD` is unset: a file whose trimmed contents are the password (the Docker-secret shape). |
| `PORT` | `3001` | The server's port. The Vite dev proxy targets the same value, so `PORT=3300 npm run dev` moves both halves together. |
| `HOST` | `127.0.0.1` | The server's bind address. Loopback by default as defense in depth — the auth gate, not the bind address, is what keeps the surface closed. A container sets `0.0.0.0` because its loopback reaches nobody, and [the direct route](#the-direct-route) sets it because other machines are the point of that route. |
| `CLODECK_PUBLIC_URL` | — | The origin a browser reaches the app at — scheme, host and port, e.g. `http://203.0.113.10:3001`. It is read for its **scheme**, and that decides the session cookie's `Secure` flag: `http:` → not `Secure`, which is what lets a bare origin hold a login ([the direct route](#the-direct-route)) at the cost of cleartext on the wire; `https:` → `Secure`. Unset or blank → `Secure`, exactly as before, and a bare `http://` origin then bounces ([why](#when-the-origin-is-not-declared)). Declaring the origin the browser types is also what a deployment behind a TLS-terminating proxy wants, even though the app itself sees plain HTTP. |
| `WEB_ROOT` | — | The built client's directory. Set → the server serves the SPA at `/`, auth-exempt, with an `index.html` fallback for deep links. Unset → the server walks up from its working directory to the repo root and serves `web/dist` if it has been built, logging the directory it picked or the reason it picked none. No build anywhere → no client is served, which is what the Vite dev loop wants. |
| `CLODECK_TRUSTED_PROXIES` | — | The proxies in front of this deployment, as a comma-separated list of addresses, CIDR ranges and the keywords `loopback` / `linklocal` / `uniquelocal` — `172.16.0.0/12` for the compose Caddy, `127.0.0.1/8` for a proxy on the same host. It is the address the **login lockout** keys on: without it, every login behind a proxy arrives from the proxy itself, so five failures — anyone's — lock out the one user there is. Unset or blank → nothing is trusted, which is what the direct and tunnelled routes want; a forged `X-Forwarded-For` is ignored by a peer outside the list either way, so only a client *inside* it can rotate the bucket. A value that is not a list of addresses is a startup warning rather than a failure: the server trusts nothing and says so. |
| `CLODECK_PROVIDER_<NAME>_BASE_URL`, `_AUTH_TOKEN`, `_MODEL` | — | One provider profile, named `<NAME>`: any subset of the endpoint, the credential and the model, with the rest inherited from this server's own `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`. Read once, at boot. See [Provider profiles](#provider-profiles). |
| `CLODECK_PERMISSION_MODE` | `default` | The permission mode a session starts in, and the one `New chat` returns to: `default` (Ask), `acceptEdits` (Accept edits), `plan` (Plan) or `bypassPermissions` (Bypass). Anything else **stops the boot** with the accepted list, as does `bypassPermissions` when `CLODECK_ALLOW_BYPASS` is off — a misconfigured mode would otherwise run every turn under a policy nobody chose. Read once, at boot. See [Permission modes](#permission-modes). |
| `CLODECK_ALLOW_BYPASS` | `on` | Whether **Bypass** may be chosen at all, in any session of this deployment. `on`/`off`, `true`/`false`, `yes`/`no` and `1`/`0` are read the way a shell writes them; **anything else is a warning and Bypass stays off**, because a gate's failure mode is to stay shut. Off, the server refuses Bypass with a reason and the picker says why. See [Bypass](#bypass). |
| `ANTHROPIC_API_KEY` | — | The default profile's credential, read by the Agent SDK from the server's environment. A profile's credential reaches its run the same way, as `ANTHROPIC_AUTH_TOKEN`. clodeck never stores, persists or invents one — it reads what you exported and hands it to the run. Only the real provider needs it — `npm run dev:fake` needs none. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where the Agent SDK keeps its transcripts — the thing session history and resume are read from. The Docker image sets `/home/node/.claude` and mounts a volume there. |

**`clodeck.config.json`** is the fallback for deployments that would rather not export an environment
variable. It is read from the server's working directory — which is `server/`, not the repo root, when
the root scripts run it, because npm runs a workspace script there:

```json
{ "projectsRoot": "/srv/projects" }
```

## Provider profiles

**A session does not have to run on the environment the server was started with.** A **provider
profile** is a named patch over that environment: declare any subset of the endpoint, the credential and
the model under `CLODECK_PROVIDER_<NAME>_*`, and the keys you leave out are inherited — from the
server's own `ANTHROPIC_*`, never from another profile. One endpoint with two models on it is therefore
two lines, not six.

| Variable | The key it declares |
|---|---|
| `CLODECK_PROVIDER_<NAME>_BASE_URL` | The Anthropic-compatible endpoint this profile talks to. |
| `CLODECK_PROVIDER_<NAME>_AUTH_TOKEN` | The credential it carries. |
| `CLODECK_PROVIDER_<NAME>_MODEL` | The model to ask for. |

```sh
# The endpoint and the credential are already this server's own environment, so
# each profile is a model alone — which is what a tier is.
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic \
ANTHROPIC_AUTH_TOKEN=sk-... \
CLODECK_PROVIDER_FLASH_MODEL=deepseek-chat \
CLODECK_PROVIDER_PRO_MODEL=deepseek-reasoner \
  npm run serve
```

All three keys together is a provider of its own, on a server whose environment points somewhere else:

```sh
CLODECK_PROVIDER_GROQ_BASE_URL=https://… \
CLODECK_PROVIDER_GROQ_AUTH_TOKEN=gsk-… \
CLODECK_PROVIDER_GROQ_MODEL=… \
  npm run serve
```

A profile's name is normalized — upper-cased, with `-` folded to `_` — so `deepseek-flash` and
`DEEPSEEK_FLASH` are one profile, and the picker lists the normalized spelling. A key under the prefix
that names no profile, or names none of the three, is reported on the server's first lines rather than
silently ignored.

**The reserved `default` profile is the server's own environment.** With nothing declared the picker
offers exactly one entry — *server environment* — and every run is the run it has always been, so **a
deployment that declares no profile changes in no way at all**. A name that clashes with `default` is
refused with a warning rather than obeyed. Profiles are read **once, at boot**: adding or changing one is
a restart, the same deliberate act as changing the password.

**The credential rule, in one line: the endpoint and its credential travel together, and the model
travels free.** A project can pin its own provider, and when it does clodeck sends the model and nothing
else — the two halves of a host-and-credential pair never come from different sources. The measurements
this rests on, and the five alternatives that were rejected, are in
[`docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`](docs/adr/0002-provider-credentials-travel-with-their-endpoint.md).

**clodeck speaks one API, so every other vendor arrives through a proxy.** A profile's endpoint has to be
**Anthropic-compatible**: clodeck talks the Anthropic Messages API and nothing else, and it grows no
translation layer. DeepSeek's `/anthropic` surface is one out of the box; a vendor without one reaches
you through a **translation proxy the operator runs**, with a profile pointed at that. The chat surface
is only as good as what the proxy passes through unaltered — `stream_event` deltas (the live bubble),
`tool_use` blocks (the tool cards), the `can_use_tool` approval round trip those blocks trigger (the
modal), and the trailing `result` (the turn's outcome).

**The picker sits beside the composer** — above the box you type in, not up in the chat header — as one
line reading `running on <model> · <profile>`. The choice is **per session**: a new session in a project
opens on the profile the last one there used, and on the server's environment when nothing is
remembered. It **locks once the session's first turn has run**, so what you are talking to cannot change
mid-conversation; a different profile means a new session, and **`New chat` in the chat header is that
door** — it drops the transcript, the session and the armed resume, and the next message starts a
session of its own (nothing is written to disk until that send). Reloading the page is a new session too,
because the binding lives in the browser and nowhere else. The picker is told names and models, and of a
pinned project's file only the endpoint it declares (which you can read in the drawer too) — **never a
credential** — and a profile the operator has since removed is refused by name, never quietly swapped for
the default. Each run logs the profile and model it used: the only record of what a turn actually ran on.

**A project can pin its own provider, and may then choose only a model.** If a project's
`.claude/settings.json` declares `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` in its `env` block, the
SDK gives that file precedence over the server's environment key by key, and clodeck neither fights it
nor duplicates it: the picker says *pinned by this project* and offers **tiers only**, because one
vendor's model name means nothing at another vendor's endpoint, and the run carries the chosen model
while the project keeps the endpoint and the credential. The file is read per turn, through the same
scoped file access the drawer uses, so a pin you edit takes effect on the next turn; a file that is
missing means *no pin* in silence — most projects pin nothing — and one that is not JSON, or whose `env`
is not an object, means *no pin* with a line in the server's log. Neither is ever a reason to fail.

**A credential written into a project file is readable by the model.** The drawer filters no dotfiles —
`.claude/settings.json` is right there in the tree — and the agent's `Read` is auto-approved and scoped
to the project, so a key hand-written into a project's settings is a key the agent it pays for can open.
That is accepted rather than engineered around, and it is why the profiles above exist: **a credential
that matters belongs in the server's environment**, which no browser is ever shown a part of.

## Permission modes

**A session chooses what the agent may do without asking, and the composer is where.** The mode picker
sits beside the provider picker — above the box you type in, not up in the chat header — and its label
names the mode the session runs under. It **stays open after the first turn**, unlike a profile: a
provider is a transport fact that would poison the conversation, while a mode is a filter for what
comes next. **A mid-turn switch bites the calls after it, in the same turn.** The SDK's own mode changes
at once, and so does the gate clodeck adds — the Bash prompt in Ask and Accept edits, Plan's denials —
because it reads the mode in force when each call arrives. Switching to Bypass frees the next command
without a modal; switching back to Ask parks it; switching into Plan denies the next edit or command.
The one thing a switch does not rewrite is what is already on your screen: an approval raised before it
is answered under the mode that raised it. The next turn starts in the new mode too.

| Mode on the picker | Wire value | Reads (`Read`, `Glob`, `Grep`) | `Edit` / `Write` | `Bash` |
|---|---|---|---|---|
| **Ask** | `default` | free | prompt | **prompt — every call, `ls` and `git status` included** |
| **Accept edits** | `acceptEdits` | free | free | **prompt — every call, `mkdir`, `rm` and `sed` included** |
| **Plan** | `plan` | free | **denied, no prompt** | **denied, no prompt** |
| **Bypass** | `bypassPermissions` | free | free | free |

*free* runs the call without asking; *prompt* parks it in the approval modal until you answer; *denied*
answers the agent without showing you anything, and the turn carries on — the model reads the refusal
and keeps working rather than the session stopping.

**This is clodeck's contract, not a forwarding of the SDK's four names, and it is deliberately
stricter in three places** — the ones that surprise. **Ask** asks before a *read-only* shell command
rather than trusting the command line. **Accept edits** asks before `rm`, `mkdir` and `sed` rather than
calling them edits. **Plan** refuses edits and shell commands instead of parking them in the modal,
because nothing executes while a plan is being written and leaving Plan is a mode change, not an
approval — the plan's own exit is refused with the rest, so the session stays in Plan until you pick
another mode. A plan may still ask you a clarifying question, and the SDK's own plan file is written
without asking; neither is a project edit. The SDK's other two modes, `auto` and `dontAsk`, are not
offered: the wire refuses them, because one classifies calls where you cannot see the classifier and
the other denies silently, which in a browser is indistinguishable from a hang. The reasoning, and the
alternatives that were rejected, are in
[`docs/adr/0003-permission-modes-are-a-contract-not-an-sdk-passthrough.md`](docs/adr/0003-permission-modes-are-a-contract-not-an-sdk-passthrough.md).

**A project's `.claude/settings.json` can tighten, never loosen.** Its `deny` and `ask` rules always
apply — in Bypass too — while its `allow` rules are neutralised for these four modes, so a project file
cannot auto-approve a call the picker says will ask. That rule is what makes the table above a promise
rather than a summary.

**The mode is session state, not a stored preference.** It starts at `CLODECK_PERMISSION_MODE` — Ask
when the variable says nothing — a `New chat` goes back to that value, a reconnect restores the run's
mode, and switching to another project and back keeps that project's run. Nothing is ever written to
disk: no project file, no registry, no session metadata, so a restart starts over at the same default.

### Bypass

**Bypass** has gates of its own, because *every tool runs without asking* is worth a deliberate click:

- **`CLODECK_ALLOW_BYPASS`** — the deployment's gate, **on** unless the operator switches it off. Off,
  the server refuses Bypass on a send and on a mid-turn switch, and the picker's row names the reason.
  A deployment that also sets `CLODECK_PERMISSION_MODE=bypassPermissions` stops at boot instead of
  running in a mode its own gate refuses.
- **The project's own settings** — `permissions.disableBypassPermissionsMode: "disable"` in
  `.claude/settings.json` refuses Bypass in that project, outranking every session in it.
- **Running as root or under sudo, outside a sandbox** — the SDK refuses Bypass outright; clodeck lets
  that refusal fail the turn out loud rather than fall back to a quieter mode.

The deployment's and the project's gates are also what switch the SDK's own
`allowDangerouslySkipPermissions` on for a run: the capability exists exactly where they allow it, and
is set from the start, which is what keeps a mid-turn switch possible.

Choosing it asks first, **every time** — there is no "remember this" — and a persistent badge stays
beside the composer while it is active. The confirmation, the badge's tooltip and this page all carry
the same sentence:

> Every tool runs without asking. A project's own deny/ask rules in `.claude/settings.json` will still apply.

A gate you cannot see is not a gate, so a refused Bypass is still *named* in the list, with the
server's sentence under it, rather than removed.

## Commands

Every command runs from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces. `npm ci` for a deployment. |
| `npm run dev` | Builds `shared`, then runs the server (`tsx watch` — reloads on change) and the web client (Vite dev server) together. Reads no file: every variable comes from the shell it is run in. |
| `npm run dev:env` | The same loop with `.env` loaded first — the shape the wizard leaves behind, where the values are in the file rather than in your shell. Names the keys it loaded, never their values, and stops plainly when there is no `.env`. `npm run dev:env -- <script>` loads it for any other script instead. |
| `npm run dev:fake` | The same, but the server runs the scripted fake Agent SDK provider instead of the real one — the whole chat surface with no API key and no network. It still needs `UI_PASSWORD`: the gate is installed the same way, so an unset password is fail-closed here too. |
| `npm run dev:fake:env` | `npm run dev:fake` with `.env` loaded first. |
| `npm run build` | Builds `shared` → `server` → `web` into each package's `dist/`. |
| `npm run serve` | **The deployment command:** a preflight that stops — plainly, before anything is built — when `UI_PASSWORD` or `PROJECTS_ROOT` is missing, then `npm run build`, then the server, serving the client it just built. |
| `bash scripts/setup-clodeck.sh` | Walks you through the configuration — projects root, password, provider profiles — then writes `.env` and the launcher `npm run serve` needs to see it. See [Or let the wizard do it](#or-let-the-wizard-do-it). |
| `bash scripts/deploy-clodeck.sh` | The same walk for a Linux **server**: it installs the prerequisites, then writes `/etc/clodeck/clodeck.env`, the login password file and a systemd unit, opens the port, and waits for `/healthz`. Re-running it changes a value. See [Linux server](#linux-server). |
| `npm start --workspace @clodeck/server` | Runs the server from `dist/`, serving the client directory it resolves (or the `WEB_ROOT` you set). Reach for `serve` unless a service manager is starting it for you. |
| `npm test` | Builds `shared`, then runs the whole Vitest suite across all packages. |
| `npm run typecheck` | Type-checks every package (`tsc` with `noEmit` — nothing is written). |
| `npm run e2e` | Runs the Playwright suite in `web/e2e/` against an app that is already up — a dev loop, plus a built one for its `direct-route` project (see [Development](#development)). |
| `npm run pr` | **The publish step:** from `main`, pushes it and opens (or prints) the `main → master` pull request whose merge deploys production. Needs an authenticated `gh`; says what to install or sign in when it has none. See [The branch model](#the-branch-model). |
| `npm run sandcastle` | Drains the ticket queue under `.scratch/clodeck/issues/` — one pass per ticket, each on its own branch in its own container, implement then review. It never merges and never pushes, so the branches wait for you. See [`.sandcastle/README.md`](.sandcastle/README.md). |

`dev`, `test`, `build` and `typecheck` all build `shared` first, because `server` and `web` resolve it
through its built `exports` (`shared/dist`) — a clean clone has nothing to import until that happens.
For the same reason, editing `shared/` while `npm run dev` is running needs a `npm run build:shared`
(or a restart) before the server and the client see the change.

## Troubleshooting

Every entry here is a symptom someone actually hit. Start with the server's first lines of output —
its warnings name their own fix.

### I sign in and land back on the sign-in screen

**The signature of an undeclared origin.** The browser reached the app at an `http://` address that is
not `localhost`, the session cookie went out `Secure` — the default, because no `CLODECK_PUBLIC_URL`
was declared — the browser discarded it, and the next call was answered `401`. Nothing is wrong with
the server, and no amount of reading its log will show it: it logs the login as a success.

Open DevTools → Network and look for `POST /api/auth/login → 200` followed by
`GET /api/auth/me → 401` (the Console also reports the blocked cookie). Then:

- **Reaching a server by IP?** Declare it: put `CLODECK_PUBLIC_URL=http://<the address the browser
  typed>:<port>` in the server's environment and restart. That is [the direct route](#the-direct-route)
  — the cookie follows the declared scheme and the login holds — and it is cleartext on the wire.
- **Prefer encryption?** An [SSH tunnel](#the-ssh-tunnel) needs no configuration and keeps the
  `Secure` cookie; [Caddy's internal certificate](#the-encrypted-alternative-caddys-internal-certificate)
  or [a domain](#docker-compose-with-a-domain) give a real `https:` origin.
- **Just started it locally?** You are on `http://localhost:5173` — check that the host in the address
  bar really says `localhost` or `127.0.0.1`, not the machine's LAN IP from the `Network:` line Vite
  prints next to `Local:`. That line is for other devices, and reaching it is
  [the direct route](#the-direct-route) — same declaration, with `:5173` as the port.
- The full mechanism is in [When the origin is not declared](#when-the-origin-is-not-declared).

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

The chat turn is the one thing that needs a credential: `ANTHROPIC_API_KEY` in the server's environment,
or a profile's `CLODECK_PROVIDER_<NAME>_AUTH_TOKEN` ([Provider profiles](#provider-profiles)). Without one
the login, the terminal, the file drawer and history all work and the turn fails; `npm run dev:fake` is
the offline stand-in, and a *wrong* key fails at the first turn with the SDK's own error in the chat.

**A turn that answers `Not logged in · Please run /login` is this, and the wording is the Agent SDK's** —
it names a Claude Code CLI command, not clodeck's login screen, and it means the server's environment
carried no credential at all. The common cause is a credential that lives in `.env` while the server was
started by something that does not read it: `npm run dev` reads no file, so the two variables in
[step 3](#3-start-it) arrive and the rest of the file does not. Start the loop with `npm run dev:env` when
`.env` is where your values are, and with `start-clodeck.*` when you are running `serve`.

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
`UI_PASSWORD` at boot; the plaintext is never kept), and sets an `HttpOnly; SameSite=Strict` session
cookie — `Secure` unless the deployment declares an `http:` public origin. Every `/api/**` route plus
both `/ws` and `/ws/terminal` require it — `/healthz` and the two auth routes are the only exemptions.
Logins are rate-limited per address (five failures lock it out for fifteen minutes, and the lock is
checked before the password so a locked address cannot burn scrypt cycles). Session ids live
server-side, so a logout or a restart invalidates them. A WebSocket upgrade is refused when its
`Origin` is not the host it was sent to.

**The address is the peer's, unless a proxy is declared.** `CLODECK_TRUSTED_PROXIES` names the hops
whose `X-Forwarded-For` the app believes — Docker's own pool in the compose deployment, `127.0.0.1/8`
for a proxy on the host, nothing at all on the direct and tunnelled routes. With none declared, every
login behind a proxy shares one bucket, so five failures lock out the legitimate user along with the
attacker; with one declared, the bucket follows the browser. The header is still only believed from a
peer inside the list, and the key is the last hop that peer added — a client naming somebody else's
address ahead of it changes nothing, so a forged header cannot lock out a user it does not own. A
client *inside* a declared range can rotate its own bucket: that is the accepted cost of declaring one
rather than trusting every private address.

**The cookie's `Secure` flag follows the declared public origin** — the one fact the app cannot work
out for itself, because behind a TLS-terminating proxy it sees plain HTTP while the browser sees
HTTPS. `CLODECK_PUBLIC_URL` states it once; undeclared, the cookie stays `Secure`, so an operator who
sets nothing sees no change at all. An `http:` origin drops the flag, which is exactly what
[the direct route](#the-direct-route) is and what it costs. The reasoning, and the alternatives that
were rejected (a `COOKIE_SECURE` boolean, `X-Forwarded-Proto`), are in
[`docs/adr/0001-session-cookie-follows-public-origin.md`](docs/adr/0001-session-cookie-follows-public-origin.md) —
if you came here asking why this cookie is not always `Secure`, that file is the answer rather than an
oversight in this one.

**What the app can touch.** Everything below is enforced, not documented intent:

- **The projects root is the whole world.** Every path from the file drawer and the file API is
  re-validated by `realpath` containment, so a symlink cannot lead out of the root, and the root itself
  can never be touched.
- **A project delete stays inside the root.** `DELETE /api/projects/:id` re-resolves the id through the
  allowlist, removes a real immediate-child directory recursively, and refuses a symlink or an ambiguous
  entry with `400` — it never follows a link, and the root is not its own child, so the root is never a
  target. It is refused while a turn or a terminal is live
  ([Deleting a project](#deleting-a-project)).
- **Writes never follow a symlink in the target's final segment**, and never overwrite an existing file
  on create, upload or move. The save route is the one deliberate overwrite, and it refuses a non-file
  target.
- **The terminal is a real shell**, running as whatever user started the server — the same privileges,
  no sandbox. Run Clodeck as a dedicated unprivileged user ([Linux server](#linux-server) shows the
  account), or use the [Docker](#docker) image, which already runs as `node`.
- **The agent's reach is the session's permission mode**, and it is enforced by the server rather than
  by hiding a button: the wire refuses a mode outside the four, the gate check refuses Bypass when the
  deployment or the project says so, and a project's own deny and ask rules apply in every mode —
  Bypass included ([Permission modes](#permission-modes)).

**Secrets.** The compose deployment keeps the password in a mounted file rather than an environment
variable, so it stays out of `docker inspect`. A provider's credential is read from the server's own
environment and handed to the run that asked for it — never stored, never persisted, never invented by
clodeck — and the environment is where it belongs: a credential written into a project's
`.claude/settings.json` is readable by the agent that spends it
([Provider profiles](#provider-profiles)), and the browser is never told one at all.

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

- **The pre-commit hook is the fastest check, not the only one.** `npm install` wires it —
  `.githooks/pre-commit`, through `core.hooksPath` — and it runs `node scripts/tickets.mjs check`,
  `npm run typecheck` and `npm test`, so a red tree is never committed. The first of the three is
  the tracker's own rule: a ticket that reads `resolved` while its checklist still has an unticked
  `- [ ]` fails the commit, so the status line and the boxes cannot drift apart. `git commit
  --no-verify` skips all three once. If the hook never seems to fire, `git config core.hooksPath`
  should answer `.githooks`; `npm run prepare` sets it. CI runs the same list — plus `npm run build`
  — on every push to `main` and every PR to `master` (see [The checks](#the-checks)).
- **Two traps are load-bearing, and both are commented where they live** so the next person does not
  "fix" them back:
  - `npm run dev` passes `--raw` to `concurrently` on purpose. Without it, `concurrently`'s
    line-prefixing streams deadlock the *real* Agent SDK's import under `tsx watch`: the server starts,
    prints nothing, never listens, and the client's proxy answers 502. `dev:fake` never imports the
    SDK, so it keeps the prefixes.
  - The Playwright config drives the machine's **installed Chrome** (`channel: 'chrome'`), because
    `npx playwright install chromium` fails on this network with `Failed to download Chrome for
    Testing`. In CI the same config leaves `channel` off and drives the Chromium the nightly job
    installs; `CI` is the switch.
- **End-to-end tests need a running app and a browser**, which is why they are not part of `npm test`:

  ```sh
  UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects PORT=3300 npm run dev   # one shell
  UI_PASSWORD=dev npm run e2e                                              # another
  ```

  The dev server must be on <http://localhost:5173>, and the server must be hashed against the same
  `UI_PASSWORD` the suite sends, because it logs in like a person does. The suite's `direct-route`
  project is the exception: it drives the **built client served by the server**, at this machine's own
  non-loopback address — loopback is exempt from the browser's `Secure` rule, so a spec there would
  assert nothing — and that spec's header names the command that puts the app up for it.

- **One commit per coherent change, never on `main`** — this repo's conventions, including the branch
  naming and the local issue tracker, are in [`AGENTS.md`](AGENTS.md).

## Publishing and CI/CD

### The branch model

Two long-lived branches, and only one of them is written by a person's push or an agent's merge:

- **`main` is integration.** Work happens on a short branch (`clodeck/<ticket>-<slug>`), which is
  merged locally with `git switch main && git merge --no-ff <branch>` and then pushed. `main` has no
  strict protection: it is where a change is *known to pass* the checks.
- **`master` is production.** It moves only by a pull request **from `main`**, merged as a **merge
  commit**; branch protection allows no direct push. The merge is the deploy trigger — not a tag, not
  a release, not a button. Require-up-to-date may stay **off**, because `master` is only ever one
  merge commit ahead of `main`, so a stale base is not a real risk.
- **`npm run pr` is the publish step.** From `main` it runs `git push origin main` and
  `gh pr create --base master --head main --fill`. If a pull request from `main` is already open it
  prints that URL instead of opening a second one, and without `gh` (or without a signed-in account)
  it stops with the commands that fix it.

Agents never push, never merge into `master`, and never force-push anything. Their branch is the
deliverable; publishing production is a person's deliberate act (AGENTS.md).

### The checks

One composite action, `.github/actions/verify/action.yml`, is the single list both workflows run:

```
npm ci → node scripts/tickets.mjs check → npm run typecheck → npm test → npm run build
```

- **`.github/workflows/ci.yml`** — on every push to `main`, every pull request targeting `master`, and
  `workflow_dispatch`. Ubuntu, Node 22, `npm ci` with the npm cache. Concurrency cancels a superseded
  run on the same ref. Its job is named `check`, and that is the required status check `master`'s
  protection points at.
- **`.github/workflows/deploy.yml`** — on a push to `master` and `workflow_dispatch` (a deliberate
  force-deploy). The `verify` job runs the same composite action on `master` itself, and only then
  does the `deploy` job SSH to the server. Concurrency is `deploy-production` with
  `cancel-in-progress: false`: a running deploy is never cancelled, a queued one waits.
- **`.github/workflows/e2e.yml`** — nightly (`02:17 UTC`) and on demand. It is **not** a required
  check and does not run on pull requests: it starts `npm run dev:fake` against a temporary
  `PROJECTS_ROOT` holding `demo` and `hello`, installs Chromium, runs
  `npm run e2e -- --project=dev-pair`, and keeps the failure screenshots. A red run is a signal, not
  a gate.

Playwright itself is the same suite in both places. Locally it drives the machine's installed Chrome;
under CI (`CI` set) it drives the Chromium the workflow installs (`web/playwright.config.ts`).

### Deploying to production

The `deploy` job holds a deploy key and runs **one SSH command**. The server's `authorized_keys` binds
that key to a forced command — `/usr/local/bin/clodeck-deploy` — so the session cannot run a shell or
a second command. The only argument it accepts is `deploy <40-hex-sha>`: the SHA the `verify` job
checked, passed through so the server cannot pull a newer `master` that nobody verified. A bare
`deploy` (or no command) falls back to `origin/master`, which is what a manual run uses. That installed
script is the root-owned copy of [`scripts/clodeck-deploy.sh`](scripts/clodeck-deploy.sh), which is
this repo's reference copy; update the two together.

One deploy:

1. `git fetch --prune origin`, then `git reset --hard <the verified SHA>` — or `origin/master` when
   no SHA was named — in `/home/clodeck/clodeck`;
2. `npm ci` **only** when `package-lock.json` moved between the live and new commits (or when
   `node_modules` is missing);
3. `npm run build` (shared → server → web);
4. `sudo /usr/bin/systemctl restart clodeck`;
5. poll `http://127.0.0.1:3001/healthz` for up to 60 seconds.

If the build, the restart or the health check fails, it resets to the commit that was live before,
runs `npm ci` (unconditionally — a half-finished install must not survive into the rollback),
rebuilds, restarts, and exits non-zero. There is **no idle gate**: a restart drops live sessions,
which is accepted (ticket 93).

### One-time setup

The runbook below is the one ticket 93 carries; it assumes the publish machine is Windows and the
server is Linux. Run it once, in order.

**1. `gh` on the publish machine.**

```powershell
winget install --id GitHub.cli
gh auth login
```

**2. Create `master` from `main`, and protect it.**

```sh
git push origin main:master
```

GitHub UI → Settings → Branches → pattern `master`: require a pull request (0 approvals), required
status check **`check`**, **Require branches to be up to date off**, force-push and deletion off,
allow administrators to bypass on, and **Automatically delete head branches off** (the head is
`main`, which must survive).

**3. Deploy key.** On the publish machine:

```powershell
ssh-keygen -t ed25519 -f "$HOME/.ssh/clodeck_deploy" -C "clodeck deploy"   # Enter, Enter
Get-Content "$HOME/.ssh/clodeck_deploy.pub"
```

**4. The server.** Install the script *before* the key — otherwise the forced command does not
exist yet. As a sudo-capable user:

```sh
sudo install -o root -g root -m 755 \
  /home/clodeck/clodeck/scripts/clodeck-deploy.sh /usr/local/bin/clodeck-deploy

sudo -u clodeck mkdir -p /home/clodeck/.ssh
sudo chmod 700 /home/clodeck/.ssh
echo 'command="/usr/local/bin/clodeck-deploy",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc ssh-ed25519 AAAA…' \
  | sudo tee -a /home/clodeck/.ssh/authorized_keys
sudo chown clodeck:clodeck /home/clodeck/.ssh/authorized_keys
sudo chmod 600 /home/clodeck/.ssh/authorized_keys

echo 'clodeck ALL=(root) NOPASSWD: /usr/bin/systemctl restart clodeck' \
  | sudo tee /etc/sudoers.d/clodeck-deploy
sudo chmod 440 /etc/sudoers.d/clodeck-deploy
sudo visudo -cf /etc/sudoers.d/clodeck-deploy

sudo -u clodeck git -C /home/clodeck/clodeck fetch origin
sudo -u clodeck git -C /home/clodeck/clodeck switch master
sudo -u clodeck git -C /home/clodeck/clodeck status -sb     # ## master...origin/master
```

The server checkout must be able to `git fetch` without a terminal — a credential helper or a
read-only deploy key — because the workflow has no TTY. It must also find `npm` on the PATH sshd
gives a non-interactive session: a distro package or NodeSource install is visible there, while an
`nvm` install usually is not, and the deploy stops with `npm is not on PATH` rather than build with a
different Node.

**5. GitHub secrets and variables.** In the repository:

```powershell
Get-Content -Raw "$HOME/.ssh/clodeck_deploy" | gh secret set DEPLOY_SSH_KEY
ssh-keyscan -H <host> | gh secret set DEPLOY_KNOWN_HOSTS
gh variable set DEPLOY_HOST --body "<address>"
gh variable set DEPLOY_USER --body "clodeck"
```

`DEPLOY_KNOWN_HOSTS` is a **pin**, not a convenience: compare its fingerprint with
`/etc/ssh/ssh_host_ed25519_key.pub` on the server before storing it. The deploy job pins it on every
connection (`StrictHostKeyChecking=yes`).

### Rollback

An automatic rollback is local to the server: it restores the previously running commit and leaves
GitHub's `master` on the bad merge commit, so the two never disagree silently. To undo the publish
itself, open a revert PR against `master` on GitHub; merging that is another deploy, of the reverted
tree.

## Docs

- [`AGENTS.md`](AGENTS.md) — working conventions for this repo: language, git flow, and how the local
  issue tracker is laid out.
- [`docs/adr/`](docs/adr) — the decisions that outlived the slice that made them. Start with
  [0001 — the session cookie's `Secure` flag follows the declared public origin](docs/adr/0001-session-cookie-follows-public-origin.md).
- [`.sandcastle/README.md`](.sandcastle/README.md) — the ticket loop: what one pass does, and the
  checklist for running it on another machine.
- [`.scratch/clodeck/`](.scratch/clodeck) — the current build effort: spec, tickets, handoff.
- [`.scratch/web-claude-ui/`](.scratch/web-claude-ui) — the wayfinder spec and the verified visual
  prototype the UI follows.
