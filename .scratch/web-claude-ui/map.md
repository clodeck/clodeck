# Map: web-claude-ui

## Destination

A written **spec** plus a **visual prototype** for a web UI that rides on the Claude Agent SDK: remote browser access to Claude Code across multiple project directories, running on a dedicated server, visually modeled on `claudecodeui`. Reaching this map's end = every open decision resolved, with a handoff-ready spec and a prototype to react to.

## Notes

- Domain: a personal (single-user) web UI over the Claude Agent SDK (TypeScript). Backend Node/TS; frontend React/Vite/Tailwind + xterm.js; Docker deploy.
- Constraint: cannot use "Claude Code" branding or claude.ai login; API-key auth only (SDK terms). The UI must carry its own name (placeholder until the user picks one).
- Standing decisions live in `AGENTS.md` — read it each session.
- Skills each session: grilling + domain-modeling; prototype skill for the look ticket; research skill for fact tickets.
- Tracker: local markdown under `.scratch/web-claude-ui/`.

## Decisions so far

- [01 — Agent SDK session, streaming and resume model](issues/01-agent-sdk-session-streaming.md): everything via `query({prompt, options})` → `AsyncGenerator<SDKMessage>`; `options.cwd` binds the project, `for await` streams `system→assistant→user→tool_progress→result`, resume via `session_id` + `options.resume`/`forkSession`/`continue`.
- [02 — Per-project web terminal (PTY)](issues/02-web-terminal-pty.md): node-pty (local `forkpty`), one pty per project in a `Map<id, IPty>`, raw bytes over one WebSocket via `@xterm/addon-attach` with out-of-band resize; security via WSS + auth + origin check, validate project path against a root allowlist, run unprivileged/container.

- [03 — Visual prototype of the UI](issues/03-visual-prototype.md): verdict **Variant A (chat-first, tools on demand)** — nav rail ▸ project+session sidebar ▸ chat stage; terminal and files in a bottom drawer. File drawer spec: toolbar (upload / new file / new folder / refresh / tree⇄list toggle) + file ops (create-in-folder, drag-move, rename, delete — all confirmed) + file actions (download, markdown preview, metadata, read-only⇄editable toggle). Terminal stays a drawer, not a peer pane.

- [04 — Backend transport and API shape](issues/04-backend-transport.md): **WebSocket (JSON), one multiplexed bus per browser session** for chat/tool events (SSE rejected), a thin normalized **envelope** (`sdk`/`approval_request`/`snapshot`/`stream_status`/`error` kinds, passthrough SDK payload), **REST for CRUD/mutations**, terminal stays on its own raw-byte WS. One active turn per project; keep-running + buffer + 60s reattach.

## Not yet specified

- Session↔project data model & persistence (resume-by-id, where session state lives) — graduates after the SDK research.
- Auth implementation detail (middleware, password/config storage, HTTPS termination) — graduates later.
- Docker image specifics.

## Out of scope

- Post-MVP features: git explorer, plugins, browser-use, live file editing, model selection (UI model picker) — beyond the MVP destination; a later effort.
- The production build itself (execution of the spec) — a later effort, not this map.
