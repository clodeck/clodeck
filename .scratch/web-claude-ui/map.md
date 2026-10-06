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

<!-- none yet -->

## Not yet specified

- Session↔project data model & persistence (resume-by-id, where session state lives) — graduates after the SDK research.
- Auth implementation detail (middleware, password/config storage, HTTPS termination) — graduates later.
- Project auto-discovery detail (env var vs config for root dir, refresh on change).
- Docker image specifics.

## Out of scope

- Post-MVP features: git explorer, plugins, browser-use, live file editing (beyond the MVP destination; a later effort).
- The production build itself (execution of the spec) — a later effort, not this map.
