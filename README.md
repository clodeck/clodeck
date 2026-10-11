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
`/healthz` and the login routes behind a gate.

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

To run the backend on its own (the server does not serve the built client yet):

```sh
npm run build
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects npm start --workspace @clodeck/server
```

## Auth

One account, password only. `POST /api/auth/login` checks the password against a salted **scrypt**
hash (built from `UI_PASSWORD` at boot; the plaintext is never kept), sets an `HttpOnly; Secure;
SameSite=Strict` session cookie, and every `/api/**` route plus both `/ws` and `/ws/terminal` require
it — `/healthz` and the two login routes are the only exemptions. Logins are rate-limited per
address (five failures lock it out), session ids live server-side (a logout or a restart invalidates
them), and a WebSocket upgrade is refused when its `Origin` is not the host it was sent to.

## Docs

- [`AGENTS.md`](AGENTS.md) — working conventions for this repo: language, and how the local issue
  tracker is laid out.
- [`.scratch/clodeck/`](.scratch/clodeck) — the current build effort: spec, tickets, handoff.
- [`.scratch/web-claude-ui/`](.scratch/web-claude-ui) — the wayfinder spec and the verified visual
  prototype the UI follows.
