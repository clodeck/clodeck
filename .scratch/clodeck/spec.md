# Clodeck — monorepo scaffold + `GET /api/projects` vertical slice

Status: ready-for-agent
Effort: clodeck (the production build; the wayfinder spec + prototype under `.scratch/web-claude-ui/` is the reference)

## Problem Statement

The wayfinder effort produced a complete spec and a verified visual prototype (Variant A) for Clodeck, but no runnable product. The build has to start somewhere, and the riskiest part is the *wiring*: getting a strict-TypeScript monorepo to share domain types between a Node backend and a React frontend, and proving one real end-to-end path — filesystem → backend → browser — works. Until `GET /api/projects` returns real, allowlist-filtered projects to a real React project switcher, none of the decisions in the wayfinder spec are validated against working code.

## Solution

Stand up the monorepo and deliver the first vertical slice: the server discovers projects under `PROJECTS_ROOT` (per ticket 05) and serves them at `GET /api/projects`; the React client fetches that list and renders it in the project switcher. Everything else from the wayfinder spec (auth, the WebSocket event bus, terminals, session history, file ops, Docker) is scaffolded-for but not implemented yet — this slice proves the skeleton and the first real path.

## User Stories

1. As a developer, I want one command at the repo root that installs and builds all three packages, so that I can start working without per-package setup.
2. As a developer, I want one shared TypeScript package that both server and web import, so that the `Project` shape and the transport envelope are defined once and cannot drift between backend and frontend.
3. As a developer, I want strict TypeScript turned on everywhere with no `any` leaking into the shared contracts, so that a contract change breaks compilation exactly where it matters.
4. As the user, I want to drop a folder into my projects directory and see it appear in the switcher after a refresh, so that adding a project is a filesystem action, not a config edit.
5. As the user, I want the switcher to list only the immediate child directories of my projects root, so that nested subfolders do not clutter the project list.
6. As the user, I want dotfile directories and plain files inside the projects root to be ignored, so that `.git` and stray files never show up as projects.
7. As the user, I want each project to have a stable identity, so that selecting it later routes to the same directory even after the server restarts.
8. As the user, I want the switcher to show a human-readable project name (the folder's basename), so that I can recognize my projects at a glance.
9. As the user, I want the list ordered alphabetically by name, so that it is predictable and easy to scan.
10. As the user, I want an empty or missing projects root to show an empty list rather than an error, so that a fresh install with no projects yet does not look broken.
11. As an operator, I want to configure the projects root with an environment variable, so that the same image can point at different host directories.
12. As an operator, I want a config-file fallback for the projects root when the env var is absent, so that non-Docker deployments can set it without exporting an env var.
13. As a security-conscious operator, I want every project path canonicalized and re-checked against the root, so that a symlink or `..` can never escape the allowlist.
14. As a security-conscious operator, I want a symlink whose real target lies outside the root to be skipped, so that scattered projects cannot be pulled in via symlink.
15. As a developer, I want discovery to re-scan on every request rather than cache, so that a single root stays fresh with no invalidation logic.
16. As a developer, I want the project id to be a reversible base64url of the canonical path, so that no id↔path lookup table is needed.
17. As a developer, I want `GET /healthz` to respond without auth, so that a healthcheck or proxy can verify the app is up.
18. As a developer, I want the server to boot with a single dev command that watches and reloads on change, so that I can iterate quickly.
19. As a developer, I want the web client to run a Vite dev server that proxies `/api` to the backend, so that I can develop against the real endpoint with no CORS configuration.
20. As a frontend developer, I want the project switcher to fetch `/api/projects` on mount and on a refresh action, so that "drop a folder in" becomes visible on the next refresh.
21. As a frontend developer, I want the switcher to show a loading state while the request is in flight, so that the UI does not misleadingly flash an empty list.
22. As a frontend developer, I want the switcher to show an error state with a retry action when the request fails, so that a dead backend is obvious and recoverable.
23. As a frontend developer, I want the switcher to render from the shared `Project` type, so that a backend contract change is caught at compile time.
24. As a developer, I want an integration test that boots the real HTTP handler against a temporary projects root and asserts the exact `{ projects: [...] }` shape, so that the endpoint's external behavior is pinned.
25. As a developer, I want a focused unit test on the path-canonicalization guard, so that the security-critical allowlist logic has its own fast, exhaustive coverage.
26. As a developer, I want the test suite to run in one command across all packages, so that a future CI step can run the whole thing with no special casing.
27. As a developer, I want the server and shared packages to emit clean TypeScript declarations, so that `web` and `server` get proper editor support when importing them.
28. As a developer, I want a root README (or AGENTS note) documenting the workspace layout and the install/dev/test commands, so that the next contributor can orient in minutes.

## Implementation Decisions

### Monorepo & tooling

- **npm workspaces** with three packages — `server/`, `web/`, `shared/` (scoped `@clodeck/*`). Root scripts drive install/dev/build/test. Chosen over pnpm for zero extra tooling; the workspace boundary is the only structural requirement.
- **Node 22, TypeScript `strict: true`** everywhere, via a shared `tsconfig.base.json` that each package extends.
- **`shared` builds to `dist` with `exports` + type declarations**; `server` and `web` consume it as a workspace dependency. No path aliases leak into runtime code.
- **One test runner across the monorepo: Vitest** (runs the Node integration test and the unit tests; later it also runs web component tests). `npm test` at the root runs all of them.
- **Dev loops:** the server uses a TS runner (tsx/tsc-watch); the web uses Vite with an `/api` proxy to the server.

### Shared types (the wayfinder's discriminated unions as real types)

- `Project = { id: string; name: string; path: string }` — `id` = base64url(canonical absolute path), `name` = basename, `path` = canonical absolute path (display-only, single-user convenience). From ticket 05 §3/§6.
- **The 04 envelope as two discriminated unions** (declared now, wired later):
  - `ServerEvent` (server→client): `{ v, seq, ts, kind, projectId?, sessionId?, turnId?, payload }` with `kind ∈ { 'sdk', 'approval_request', 'snapshot', 'stream_status', 'error' }` and each `payload` typed per kind (04 §2).
  - `ClientMessage` (client→server control): `{ v, id, type, payload }` with `type ∈ { 'send_prompt', 'interrupt', 'approval_response', 'set_permission_mode', 'resume' }`.
- **`SDKMessage` passthrough:** `shared` declares a *structural mirror* of the SDK message union the client renders (the `system`/`assistant`/`user`/`tool_progress`/`stream_event`/`result` subset from research 01 §2/§3), and the `sdk` envelope kind's payload is that mirror. **Rationale:** `shared` must not depend on `@anthropic-ai/claude-agent-sdk` (it bundles a native binary and would drag into `web`); the server imports the real `SDKMessage` type and assigns to the shared mirror. The SDK stays a server-only dependency.
- For this slice only `Project` is *consumed*; the envelope and `SDKMessage` types are declared-but-unused so the transport landings (04/06) never have to re-model them and `web` compiles against them from day one.

### Server

- **HTTP framework: Fastify** (typed routes; cookie/static plugin story for later slices), with `ws` reserved for the future WebSocket bus. The framework is an implementation detail behind the route handlers, not a spec-level contract; Express is the fallback.
- **Modules honor the wayfinder's seams** (05 §7):
  - **Discovery resolver** behind one interface — `listProjects(): Promise<Project[]>` (the multi-user seam; nothing else reads the filesystem directly).
  - **Allowlist policy** as a separate surface — `canonicalizeInsideRoot(raw): string | null` — `realpath`-resolves both the root and the candidate and returns the canonical path only if it resolves inside the root; `null`/skip otherwise. Every operation re-validates here (defense-in-depth); decoding an id is never treated as authorization.
  - **Config:** `PROJECTS_ROOT` env var, with a config-file fallback (`projectsRoot`). Missing root → empty list + a log line, never a 500.
- **`GET /api/projects` → `200 { projects: Project[] }`**, alphabetical by `name`, on-demand `readdir` (no cache), skipping dotfile dirs / non-dirs / symlinks whose realpath escapes the root; empty dirs included. Missing/unreadable/empty root → `200 { projects: [] }`.
- **`GET /healthz` → `200`**, auth-exempt (08). In this slice all `/api/**` is temporarily unauthenticated; the route layout is structured so the principal-aware middleware from 07 slots in front of `/api/**` and `/ws**` without rework.

### Web

- **React + Vite + Tailwind** (per AGENTS.md), scaffolding the app shell so later slices (chat/terminal/file drawer) have a home; this slice renders only the project switcher.
- **The switcher:** fetches `/api/projects` on mount and on a refresh affordance; loading and error(+retry) states; renders `Project[]` from `shared`; no hardcoded fixtures (the prototype's mock data is not imported).
- **Vite dev proxy** `/api` → the server (no CORS in development).
- The switcher is the only interactive surface this slice; chat, terminal, and the file drawer are stubbed placeholders (Variant A layout is the eventual target, not built here).

## Testing Decisions

- **What makes a good test:** assert *external behavior* only. For the endpoint, the HTTP status and the exact `{ projects: [...] }` contents; never private functions or file layout. For the allowlist, test inputs→outputs (accepted/canonicalized vs. rejected) against temp directories — do not mock `fs`.
- **Modules tested (the two agreed seams):**
  1. **HTTP boundary (integration):** boot the real route handler (or Fastify instance) with a temporary `PROJECTS_ROOT` fixture; assert `GET /api/projects` returns the exact shape with correct `id`/`name`/`path`, alphabetical order, dotfile/non-dir/symlink-escape exclusion, empty-dir inclusion, and that `GET /healthz` returns 200.
  2. **Allowlist unit:** exhaustively cover `canonicalizeInsideRoot` — in-root path accepted, `..` traversal rejected, symlink-to-outside-root rejected, symlink-to-inside-root accepted, non-existent path rejected.
- **Prior art:** the repo has no production tests yet (the prototype's `verify.mjs` is a CDP smoke check of throwaway code, not a model). The wayfinder's seam design (05 §7) is the prior art these tests make executable for the first time.
- **Non-goal this slice:** no browser-level e2e and no web component tests — the switcher is verified by manual dev-server inspection; a web test seam arrives with the chat slice.

## Out of Scope

- Auth/login (07) — this slice ships unauthenticated `/api/**`; principal-aware middleware is a later slice.
- The WebSocket event bus `/ws` and the 04 control messages (send/interrupt/approval/resume) — types declared, transport not built.
- Per-project terminal (02).
- Session list / transcript endpoints and resume (06).
- File drawer REST ops and the file viewer beyond the prototype (03).
- Docker image / docker-compose / Caddy (08) — only `GET /healthz` is delivered now because the server needs it to boot cleanly.
- Chat streaming against the Agent SDK — no `query()` call in this slice.
- Live project push (`fs.watch`) — on-demand rescan only (05 §4).
- CI pipeline, linting, and formatting enforcement (add after the scaffold proves out).
- Browser-level end-to-end tests.

## Further Notes

- This is the first spec of the **clodeck** build effort; the wayfinder effort (`.scratch/web-claude-ui/`) is the reference. All domain terms (`Project`, envelope, allowlist, `session_id`/`turnId`, …) come from that spec — keep using them.
- The slice is deliberately thin: its value is proving the monorepo + the first real path, not implementing features. Resist adding auth, WS, or the terminal "while we're here".
- `~/.claude` / `CLAUDE_CONFIG_DIR` and `ANTHROPIC_API_KEY` are not touched in this slice (no SDK calls yet).
- The envelope + `SDKMessage` types are declared-but-unused on purpose; wire them when the chat bus lands, and treat the SDK as a server-only dependency.
- A build-effort map is not yet created; this spec is the entry point. Before an agent starts, split it into implementation tickets (one per file under `issues/`, numbered from `01`) per the tracker convention.
