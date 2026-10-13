# 05 — Project discovery

Type: grilling
Status: resolved
Blocked by: 04

> **Partly superseded — 2026-10-13.** Adding a project is no longer a filesystem-only action: the UI can
> create one under the root. This reverses the "drop a folder in is the only door" reading of the answer
> below; everything about *how discovery scans* still holds — one root, the root as the allowlist,
> immediate child directories, `base64url(canonical path)`, dot-directories skipped, on-demand rescan.
> See [46 — a project can be created from the UI](../../clodeck/issues/46-project-creation-decision.md);
> built by ticket 47.

## Question

How does the server discover the set of projects (directories) the user can switch between — env var vs config file vs filesystem scan of a root directory? How does a newly added directory show up (refresh on change, rescan interval, manual rescan)? And what is the security boundary for which directories are allowed (root allowlist)?

## Answer

**Verdict: filesystem scan of a single projects root (`PROJECTS_ROOT`, env var with a config-file fallback).** Each immediate child directory of the root is one project; the root itself is the allowlist. Discovery is an on-demand rescan (no watcher/poller in MVP); identity is `base64url(canonical absolute path)` with the directory basename as the display name. Every path is canonicalized (`realpath`), and every operation — not just the project list — re-validates against the allowlist.

### 1. Discovery mechanism

- **Single projects root.** The server treats one directory as the container: its *immediate child directories* are the projects. `PROJECTS_ROOT` is the primary way to set it (Docker-friendly: `docker run -e PROJECTS_ROOT=/projects -v /projects:/projects`); a config file (`projectsRoot`) is the fallback when the env var is absent.
- **Why scan, not a list:** a dedicated single-user server that "hosts both the UI and all project folders" (AGENTS.md) already has one place folders live. A scan gives "drop a folder in = it appears" for free and makes the allowlist trivial (everything under the root). An explicit config/env list adds manual bookkeeping that buys nothing for a single user.
- **Rejected:** explicit per-project list (config or env `PROJECTS=a,b,c`) — the refresh question degenerates to "edit config + reload", and the allowlist must be maintained by hand. Multi-root scan (N allowed roots) is the escape hatch if projects ever live scattered; not needed for MVP.

### 2. What counts as a project (scan shape)

- **Immediate children only.** A child directory is a project; directories *inside* a project are just folders visible in the file viewer, not separate projects (matches "each project = one directory = one session"). Recursive depth would make `root/foo/bar` ambiguous.
- **Skip dotfile directories** (`.git`, `.cache`, `.config`, …), **skip non-directories** (files), **skip symlinks whose realpath escapes the root** (see §5).
- **Any directory counts, even empty.** No `.git` (or any other) signal is required — "drop a folder in" is the whole model.
- **Implication (accepted):** a project nested deeper (`root/org/repo`) is not discovered; it must be moved to the root, or multi-root is adopted later.

### 3. Identity & metadata

- **`id` = `base64url(canonical absolute path)`.** Reversible, URL-safe, stateless — the backend decodes the id back to the path with no id↔path lookup table. Stable across rescans (it changes only if the path changes). For a single user, hiding the path buys nothing, so a hash id's opacity plus its registry is complexity without benefit.
- **`name` = basename of the directory** (the entry name — what the user sees). A manual name override (a per-project metadata file or config entry) is out of MVP.
- **Ordering** = alphabetical by name (deterministic; locale/case handling is a detail, not a decision).

### 4. Refresh semantics

- **On-demand rescan.** Every `GET /api/projects` re-`readdir`s the root — a single root is cheap, so no cache. The UI refetches on sidebar mount and on a refresh affordance (the file drawer already has a refresh button per 03).
- **No background watcher or poll interval in MVP.** "Drop a folder in = it appears on the next refresh" is the MVP contract. Live push (`fs.watch` → a `projects_changed` event on the 04 WS bus) is a later upgrade, not a spec commitment now.

### 5. Security boundary (allowlist)

- **The root is the allowlist.** Every project path — and every file/terminal operation derived from it — is **canonicalized with `realpath`** and must resolve to a location *inside* the configured root. A path that resolves outside the root (a `..` traversal, or a symlink escaping the root) is rejected/skipped.
- **Enforcement is defense-in-depth, not list-time-only.** The allowlist check lives at every boundary that takes a project id/path: project listing, the file-drawer ops (`/api/projects/:id/files/**`), and the terminal (both already flagged in 02 and 04). Decoding an id to a path is **not** treated as authorization.
- **Symlink policy:** symlinks *inside* the root are fine; a symlink whose `realpath` escapes the root is skipped (not a project). Consequence: you cannot pull a scattered project into the root via symlink — scattered projects mean multi-root (rejected for MVP), not symlink-escape.

### 6. API shape

```jsonc
// GET /api/projects
{ "projects": [ { "id": "<base64url canonical path>", "name": "<basename>", "path": "/projects/foo" } ] }
```

- **Wrapped object** (`{ projects: […] }`), not a bare array — leaves room for pagination/total later.
- **`path` (the canonical absolute path) is included** alongside the reversible `id` because it is human-readable (tooltips, terminal cwd display) and a single-user trust model means leaking server layout is fine. The `id` remains the routing/authority token; `path` is display-only.
- **Missing/unreadable/empty root → `{ "projects": [] }`**, never a 500; the misconfiguration is logged.

### 7. Multi-user seam (deliberate constraint)

MVP is single-user, but discovery must not dead-end into single-user. Recorded so a later multi-user change is additive, not a rewrite:

- **Discovery and the allowlist are separate, modular surfaces** (a project registry/resolver and an allowlist policy, each behind one interface). Later per-user scoping — `PROJECTS_ROOT/{userId}`, a per-user root list, or an ACL on top — parameterizes those surfaces with an actor rather than rewriting them.
- **The reversible id is an *identifier*, not a *credential*.** The backend must re-validate the allowlist on every request; it must never trust "id decodes to a path, therefore allowed". This keeps path-based ids from becoming an accidental authorization mechanism that multi-user would have to rip out.
- **`path` in the API is a single-user convenience.** Nothing in the client may depend on it for security; under multi-user it becomes user-scoped or hidden.

Backing: [04 — Backend transport and API shape](04-backend-transport.md) (`GET /api/projects`), [01 — Agent SDK session/streaming/resume](01-agent-sdk-session-streaming.md) (`options.cwd` binds the project), [02 — Web terminal (PTY)](02-web-terminal-pty.md) (root-allowlist validation).
