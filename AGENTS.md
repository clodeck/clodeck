# AGENTS.md

## Language

Respond to the user in **Finglish** (Romanized Persian). The user's own messages are usually Finglish or Persian. Keep technical terms in English.

## Project

This repo hosts a **wayfinder** effort. Destination: a *spec* plus a *visual prototype* for a **web UI that rides on the Claude Agent SDK** — remote browser access to Claude Code across multiple project directories, running on a dedicated server, visually modeled on `claudecodeui` (github.com/siteboon/claudecodeui).

- **Issue tracker:** local markdown under `.scratch/<effort>/` (no git remote is configured, so the local tracker is the default). Map = `.scratch/<effort>/map.md`; tickets = `.scratch/<effort>/issues/NN-<slug>.md`.
- **Domain docs:** `GLOSSARY.md` / `docs/adr/` created lazily by the domain-modeling skill.

## Standing decisions (this effort)

- Destination = spec + prototype (not a full build yet).
- Single user; a dedicated server hosts both the UI and all project folders.
- Build from scratch; `claudecodeui` is the visual/feature reference only.
- Primary interaction: chat over the Agent SDK, plus a per-project shell terminal.
- Each project = one directory = one Agent SDK session + terminal + read-only file viewer; a project switcher on top.
- Stack: Node/TypeScript backend (Agent SDK TypeScript) + React/Vite/Tailwind + xterm.js. (.NET considered and rejected: the Agent SDK ships TypeScript/Python only — no .NET binding — so a .NET backend would shell out to a sidecar anyway.)
- Auth: single-account login (like claudecodeui) over HTTPS — no Tailscale, no raw HTTP basic-auth.
- MVP scope: streaming chat + session history/resume + project switcher + read-only file viewer + shell terminal. Out of MVP: git explorer, plugins, browser-use, live file editing.
