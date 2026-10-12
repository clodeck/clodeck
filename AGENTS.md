# AGENTS.md

## Language

Respond to the user in **Finglish** = Persian written in Latin letters, never in Persian script — even when the user's own message is in Persian script. Keep technical terms in English.

## Project

This repo hosts a **wayfinder** effort. Destination: a *spec* plus a *visual prototype* for a **web UI that rides on the Claude Agent SDK** — remote browser access to Claude Code across multiple project directories, running on a dedicated server, visually modeled on `claudecodeui` (github.com/siteboon/claudecodeui).

- **Issue tracker:** local markdown under `.scratch/<effort>/` — the local tracker is still the default now that the repo has a GitHub remote (`clodeck/clodeck`). Map = `.scratch/<effort>/map.md`; tickets = `.scratch/<effort>/issues/NN-<slug>.md`.
- **Domain docs:** `GLOSSARY.md` / `docs/adr/` created lazily by the domain-modeling skill.

## Git workflow

**Never commit on `main`.** Every change — code, docs, tickets, handoff — goes on its own branch, and lands on `main` only by an explicit merge.

1. **Branch first.** `git switch -c <effort>/<ticket>-<slug>` off `main` before the first commit (e.g. `clodeck/31-terminal-accumulates-on-switch`). No ticket? Use the effort name plus a short slug, and a `docs/` prefix for a docs-only change.
2. **Commit on the branch**, one commit per coherent change, in the repo's own style (lowercase scope prefix, a sentence saying what and why). The pre-commit hook runs `npm run typecheck` and `npm test` — a red tree is never committed; `--no-verify` only if the user asks for it.
3. **Stop at the merge.** Do not merge into `main`, do not push, and do not open a PR unless the user asks. When they do: `git switch main && git merge --no-ff <branch>`, then delete the branch.

A docs-only or handoff-only change is **not** an exception.

## Standing decisions (this effort)

- Destination = spec + prototype (not a full build yet).
- Single user; a dedicated server hosts both the UI and all project folders.
- Build from scratch; `claudecodeui` is the visual/feature reference only.
- Primary interaction: chat over the Agent SDK, plus a per-project shell terminal and file drawer.
- Each project = one directory = one Agent SDK session + terminal + a file drawer (scoped read **and** write); a project switcher on top.
- File access is scoped to the project root: every path is re-validated by `realpath` containment. Writes never follow a symlink in the target's final segment, never overwrite on create/upload (the save route is the one deliberate overwrite, and it refuses a non-file target), and can never touch the project root.
- Stack: Node/TypeScript backend (Agent SDK TypeScript) + React/Vite/Tailwind + xterm.js. (.NET considered and rejected: the Agent SDK ships TypeScript/Python only — no .NET binding — so a .NET backend would shell out to a sidecar anyway.)
- Auth: single-account login (like claudecodeui) over HTTPS — no Tailscale, no raw HTTP basic-auth.
- MVP scope: streaming chat + session history/resume + project switcher + file drawer (scoped read + write: inline tree expansion + new file, new folder, rename, delete, upload, and content editing via an editable toggle + save) + shell terminal. Out of MVP: git explorer, plugins, browser-use, markdown preview, model selection (UI model picker).
