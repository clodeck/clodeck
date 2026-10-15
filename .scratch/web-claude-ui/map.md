# Map: web-claude-ui

## Destination

A written **spec** plus a **visual prototype** for a web UI that rides on the Claude Agent SDK: remote browser access to Claude Code across multiple project directories, running on a dedicated server, visually modeled on `claudecodeui`. Reaching this map's end = every open decision resolved, with a handoff-ready spec and a prototype to react to.

## Notes

- Domain: a personal (single-user) web UI over the Claude Agent SDK (TypeScript). Backend Node/TS; frontend React/Vite/Tailwind + xterm.js; Docker deploy.
- Constraint: cannot use "Claude Code" branding or claude.ai login; API-key auth only (SDK terms). The UI's own name is **Clodeck**.
- Standing decisions live in `AGENTS.md` — read it each session.
- Skills each session: grilling + domain-modeling; prototype skill for the look ticket; research skill for fact tickets.
- Tracker: local markdown under `.scratch/web-claude-ui/`.

## Decisions so far

- [01 — Agent SDK session, streaming and resume model](issues/01-agent-sdk-session-streaming.md): everything via `query({prompt, options})` → `AsyncGenerator<SDKMessage>`; `options.cwd` binds the project, `for await` streams `system→assistant→user→tool_progress→result`, resume via `session_id` + `options.resume`/`forkSession`/`continue`.
- [02 — Per-project web terminal (PTY)](issues/02-web-terminal-pty.md): node-pty (local `forkpty`), one pty per project in a `Map<id, IPty>`, raw bytes over one WebSocket via `@xterm/addon-attach` with out-of-band resize; security via WSS + auth + origin check, validate project path against a root allowlist, run unprivileged/container.

- [03 — Visual prototype of the UI](issues/03-visual-prototype.md): verdict **Variant A (chat-first, tools on demand)** — nav rail ▸ project+session sidebar ▸ chat stage; terminal and files in a bottom drawer. File drawer spec: toolbar (upload / new file / new folder / refresh / tree⇄list toggle) + file ops (create-in-folder, drag-move, rename, delete — all confirmed) + file actions (download, markdown preview, metadata, read-only⇄editable toggle). Terminal stays a drawer, not a peer pane.

- [04 — Backend transport and API shape](issues/04-backend-transport.md): **WebSocket (JSON), one multiplexed bus per browser session** for chat/tool events (SSE rejected), a thin normalized **envelope** (`sdk`/`approval_request`/`snapshot`/`stream_status`/`error` kinds, passthrough SDK payload), **REST for CRUD/mutations**, terminal stays on its own raw-byte WS. One active turn per project; keep-running + buffer + 60s reattach.

- [05 — Project discovery](issues/05-project-discovery.md): **single-root filesystem scan** (`PROJECTS_ROOT` env var, config fallback) — immediate child dirs are projects (skip dotfiles/non-dirs/symlink-escapes; empty dirs ok); `id` = base64url(canonical path), `name` = basename; **on-demand rescan** (no watcher/poll in MVP); **keep-running + hide** on removal/rename; the root is the **allowlist**, enforced everywhere (id is an identifier, never a credential); discovery/allowlist kept modular so multi-user stays additive. — **Superseded in part, 2026-10-13:** a project can now be created from the UI, so "drop a folder in" is no longer the only door ([46](../clodeck/issues/46-project-creation-decision.md)); the scan itself is unchanged.

- [06 — Session ↔ Project data model & persistence](issues/06-session-project-data-model.md): the SDK transcript store (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) is the single source of truth — **no server session DB**; **session** = SDK `session_id` (persisted, one resumable conversation), **turn** = 04's `turnId` (ephemeral); default-fresh + explicit resume (`continue: true` = one-click); history via `listSessions()`/`getSessionMessages()`, normalized to the live renderer shape; empty chats are client state (no row until first send); `~/.claude` is a Docker volume, `sessionStore` the future seam.

- [07 — Auth & Permissions](issues/07-auth-permissions.md): single-account login over HTTPS via **httpOnly session cookie** (`SameSite=Strict` + origin check; WS auth rides the cookie) + in-memory server-side session store behind an interface; **password-only** (`UI_PASSWORD`/`UI_PASSWORD_FILE`, bcrypt/argon2 hash, timing-safe); TLS at a **reverse proxy (Caddy)** with direct-TLS fallback; **principal-aware** middleware (`"default"` principal = the multi-user seam), everything gated; per-IP login rate-limit + lockout. — **Superseded in part, 2026-10-15:** `Secure` is no longer unconditional; the session cookie follows the scheme of the declared public origin (`CLODECK_PUBLIC_URL`), so a bare `http://` origin is a supported **direct route** ([ADR](../../docs/adr/0001-session-cookie-follows-public-origin.md), [spec-07](../clodeck/spec-07-direct-route.md)).

- [08 — Docker image specifics](issues/08-docker-image.md): docker-compose with **app + Caddy sidecar** (app also standalone), multi-stage from **`node:22-bookworm-slim` (glibc)** (node-pty + SDK native binary); `~/.claude` = named volume, `PROJECTS_ROOT` = bind mount, secrets via env/secret-file; non-root + `init: true` (tini) + `GET /healthz`.

## Not yet specified

_none — every open decision for this effort is resolved._

## Out of scope

- Post-MVP features: git explorer, plugins, browser-use, live file editing — beyond the MVP destination; a later effort. **Superseded 2026-10-15:** `model selection (UI model picker)` was this list's fifth member and is now *in* scope — `.scratch/clodeck/issues/66-provider-profiles-decision.md`.
- The production build itself (execution of the spec) — a later effort, not this map.
