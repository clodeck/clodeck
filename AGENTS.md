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
- Each project = one directory = one Agent SDK session + terminal + a file drawer (scoped read **and** write); a project switcher on top. A project is still an immediate child directory of the projects root — the root stays the allowlist, `id` stays `base64url` of the canonical path, and there is no registry or metadata — but adding one is **no longer a filesystem-only action**: the UI can also create one with `POST /api/projects` (decision 2026-10-13, `.scratch/clodeck/issues/46-project-creation-decision.md`; built by ticket 47). The filesystem stays the mechanism, it stops being the only door.
- Layout (**web-claude-ui decision 03**, Variant A — "chat first, tools on demand"; not the `D3` in the MVP bullet below): a narrow icon rail ▸ project sidebar ▸ chat stage. The sidebar lists projects only; sessions stay behind the chat header's History button. The terminal **and** the file drawer live in **one summonable bottom drawer** opened from the rail and shut on first load — they are never a permanent column beside the chat.
- File access is scoped to the project root: every path is re-validated by `realpath` containment. Writes never follow a symlink in the target's final segment, never overwrite on create/upload/move (the save route is the one deliberate overwrite, and it refuses a non-file target), and can never touch the project root.
- Stack: Node/TypeScript backend (Agent SDK TypeScript) + React/Vite/Tailwind + xterm.js. (.NET considered and rejected: the Agent SDK ships TypeScript/Python only — no .NET binding — so a .NET backend would shell out to a sidecar anyway.)
- Auth: single-account login (like claudecodeui) over HTTPS — no Tailscale, no raw HTTP basic-auth. The session cookie's `Secure` flag follows the **declared public origin** (`CLODECK_PUBLIC_URL`), so a bare `http://` origin is a supported **direct route** — cleartext, and warned about at startup and on the login screen — while an undeclared origin keeps the cookie `Secure` exactly as before (`docs/adr/0001-session-cookie-follows-public-origin.md`).
- Provider profiles (**decision 2026-10-15**, `.scratch/clodeck/issues/66-provider-profiles-decision.md`; built by tickets 67–70): a **session**, not a project, chooses the provider it runs on — a cheap model for grunt work and a strong one for design in the same project, switched between. A profile is a *patch* over the server's environment (`CLODECK_PROVIDER_<NAME>_*`: any subset of endpoint, credential and model, the rest inherited) and the reserved default profile is the server's own environment. **Endpoint and credential travel together; the model travels free** (`docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`): a project whose `.claude/settings.json` declares either one keeps both, and a session's choice degrades to the model — because that file already overrides the server's `ANTHROPIC_*` **per key**, so a single key in it could otherwise send a credential to a host it was never issued for. The effective provider is always shown, and clodeck still persists nothing. This narrows ticket 07's *"the server never handles the API key"* to **never stores, never persists, and never invents one**.
- MVP scope: streaming chat + session history/resume + project switcher (with **creating a project from the sidebar**, `POST /api/projects`) + file drawer (scoped read + write: inline tree expansion + new file, new folder, rename, delete, upload, drag-move of a file onto a folder, download of a file's real bytes, content editing via an editable toggle + save, markdown preview with a `Preview ⇄ Source` toggle, `size · modified` on file rows, a tree ⇄ flat-list toggle, and a line-number gutter + rough syntax colouring in the code view) + shell terminal. Download, markdown preview, file-row metadata, the tree ⇄ list toggle and drag-move were promoted from out-of-MVP by decision **D3** (in `.scratch/clodeck/prototype-parity.md`, 2026-10-12); the code view's gutter and colouring are the one **P2** item that decision selected; creating a project from the UI was brought in by the 2026-10-13 decision on ticket 46 (built by ticket 47); **per-session provider profiles** were brought in by the 2026-10-15 decision on ticket 66 (built by tickets 67–70), under the credential rule the provider bullet above states; the composer's **`/` command menu** was brought in by ticket 75 (2026-10-17, `.scratch/clodeck/issues/75-slash-command-menu.md`) — `/` lists the **session's own** commands, filtered as you type, derived from the project's `.claude/` before the first send and from the SDK's own list after it, and never clodeck's own buttons. Out of MVP: git explorer, plugins, browser-use.
