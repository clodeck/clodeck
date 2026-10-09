# 03: Server projects endpoint (`GET /api/projects`)

**What to build:** The server boots and serves the project list to the browser: dropping a folder into the projects directory makes it appear in the list after a refresh, and only the immediate child directories of the root ever show up. Every path is canonicalized and re-checked against the root so a symlink or `..` can never escape the allowlist.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `GET /healthz` responds `200` without auth.
- [ ] `GET /api/projects` returns exactly `200 { projects: Project[] }`, ordered alphabetically by `name`.
- [ ] The projects root comes from `PROJECTS_ROOT` env var with a config-file fallback; a missing/unreadable/empty root returns `200 { projects: [] }`, never a 500.
- [ ] Discovery re-scans on every request (no cache); `id` = base64url of the canonical path, `name` = basename.
- [ ] Dotfile directories, plain files, and symlinks whose realpath resolves outside the root are excluded; empty directories are included.
- [ ] `canonicalizeInsideRoot` is the single allowlist seam: it realpath-resolves both root and candidate and returns the canonical path only when it lies inside the root; decoding an id is never treated as authorization.
- [ ] An integration test boots the real HTTP handler against a temporary projects root and asserts the exact `{ projects: [...] }` shape, alphabetical order, dotfile/non-dir/symlink-escape exclusion, empty-dir inclusion, and `GET /healthz` 200.
- [ ] A focused unit test exhaustively covers `canonicalizeInsideRoot`: in-root path accepted, `..` traversal rejected, symlink-to-outside rejected, symlink-to-inside accepted, non-existent path rejected — against real temp directories (no `fs` mocking).
