# Clodeck

Remote browser access to Claude Code across multiple project directories: a chat UI over the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview), one session per project, with
a terminal and a read-only file viewer alongside. One user, one dedicated server that also hosts the
project folders.

**Status: first vertical slice.** Project discovery, `GET /api/projects`, and the project switcher
work end to end. Chat, terminals, the file viewer, auth, and the WebSocket event bus are scaffolded
for but not built — [the spec](.scratch/clodeck/spec.md) and its [tickets](.scratch/clodeck/issues)
are the plan of record.

## Layout

Three npm workspaces, scoped `@clodeck/*`:

| Package | What it owns |
|---|---|
| [`shared/`](shared) | `@clodeck/shared` — the domain types (`Project`) and the transport contracts (the event/message envelopes, the Agent SDK message mirror). Both other packages import it, so a contract change breaks compilation on both sides at once. |
| [`server/`](server) | `@clodeck/server` — the Node/Fastify backend: project discovery over the filesystem, and the HTTP surface (`/healthz`, `/api/**`). |
| [`web/`](web) | `@clodeck/web` — the React + Vite + Tailwind client: the project switcher today, the chat / terminal / file-drawer surfaces later. |

## Requirements

Node ≥ 22.12 (npm workspaces). Nothing else — no database, no global tooling.

## Commands

Every command runs from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces. |
| `npm run dev` | Builds `shared`, then runs the server (`tsx watch` — reloads on change) and the web client (Vite dev server) together. |
| `npm test` | Builds `shared`, then runs the whole Vitest suite across all packages. |
| `npm run build` | Builds `shared` → `server` → `web` into each package's `dist/`. |
| `npm run typecheck` | Type-checks every package (`tsc` with `noEmit` — nothing is written). |

`dev`, `test`, `build`, and `typecheck` all build `shared` first, because `server` and `web` resolve
it through its built `exports` (`shared/dist`) — a clean clone has nothing to import until that
happens. For the same reason, editing `shared/` while `npm run dev` is running needs a
`npm run build:shared` (or a restart) before the server and client see the change.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PROJECTS_ROOT` | — | The directory whose immediate child directories are the projects. Unset or empty → an empty list, never an error. |
| `PORT` | `3001` | The server's port. |
| `HOST` | `127.0.0.1` | The server's bind address. Loopback by default, because `/api/**` is still unauthenticated; a container sets it to bind its own interface. |

`clodeck.config.json` is the fallback for deployments that would rather not export an environment
variable. It is read from the server's working directory — which is `server/`, not the repo root,
when the root scripts run it, because npm runs a workspace script there:

```json
{ "projectsRoot": "/srv/projects" }
```

## Try it

```sh
npm install
mkdir -p ~/clodeck-projects/hello
PROJECTS_ROOT=~/clodeck-projects npm run dev
```

Then open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend on
`127.0.0.1:3001`, so the client develops against the real endpoint with no CORS setup. Drop another
directory into the projects root and press the switcher's refresh.

On Windows PowerShell:

```powershell
$env:PROJECTS_ROOT = "$HOME\clodeck-projects"; npm run dev
```

To run the backend on its own (the server does not serve the built client yet):

```sh
npm run build
PROJECTS_ROOT=~/clodeck-projects npm start --workspace @clodeck/server
```

## Docs

- [`AGENTS.md`](AGENTS.md) — working conventions for this repo: language, and how the local issue
  tracker is laid out.
- [`.scratch/clodeck/`](.scratch/clodeck) — the current build effort: spec, tickets, handoff.
- [`.scratch/web-claude-ui/`](.scratch/web-claude-ui) — the wayfinder spec and the verified visual
  prototype the UI follows.
