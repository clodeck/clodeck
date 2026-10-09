# Clodeck

Remote browser access to Claude Code across multiple project directories: a chat UI over the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview), one session per project, with
a terminal and a read-only file viewer alongside. One user, one dedicated server that also hosts the
project folders.

**Status: two slices in.** Project discovery, `GET /api/projects` and the project switcher work end
to end. So does the chat surface: streaming Agent SDK turns over a WebSocket bus at `/ws`, tool
cards, the approval modal, and session history / resume over REST. Terminals, the file viewer and
auth are scaffolded for but not built — the specs and tickets under
[`.scratch/clodeck/`](.scratch/clodeck) are the plan of record.

## Layout

Three npm workspaces, scoped `@clodeck/*`:

| Package | What it owns |
|---|---|
| [`shared/`](shared) | `@clodeck/shared` — the domain types (`Project`) and the transport contracts (the event/message envelopes, the Agent SDK message mirror). Both other packages import it, so a contract change breaks compilation on both sides at once. |
| [`server/`](server) | `@clodeck/server` — the Node/Fastify backend: project discovery over the filesystem, the Agent SDK behind a provider facade, the session bus at `/ws`, and the HTTP surface (`/healthz`, `/api/**`). |
| [`web/`](web) | `@clodeck/web` — the React + Vite + Tailwind client: the project switcher and the streaming chat surface today, the terminal / file drawer later. |

## Requirements

Node ≥ 22.12 (npm workspaces). Nothing else — no database, no global tooling.

## Commands

Every command runs from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces. |
| `npm run dev` | Builds `shared`, then runs the server (`tsx watch` — reloads on change) and the web client (Vite dev server) together. |
| `npm run dev:fake` | The same, but the server runs the scripted fake Agent SDK provider instead of the real one — the whole chat surface with no API key and no network. Use this for UI work. |
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
| `HOST` | `127.0.0.1` | The server's bind address. Loopback by default, because `/api/**` and `/ws` are still unauthenticated; a container sets it to bind its own interface. |
| `ANTHROPIC_API_KEY` | — | Read by the Agent SDK from the server's environment; the server itself never reads, stores or forwards it. Only the real provider needs it — `npm run dev:fake` needs none. |

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

Then open <http://localhost:5173>. The Vite dev server proxies both `/api` and `/ws` to the backend
on `127.0.0.1:3001`, so the client develops against the real endpoints with no CORS setup. Drop
another directory into the projects root and press the switcher's refresh; select a project and the
chat panel opens a session against it.

Without an API key, run `npm run dev:fake` instead — the server then answers from a scripted fake
provider, so the whole chat surface (streaming, tool cards, the approval modal, history and resume)
is exercisable offline.

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
