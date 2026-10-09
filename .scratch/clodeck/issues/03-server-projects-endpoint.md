# 03: Server projects endpoint (`GET /api/projects`)

**What to build:** The server boots and serves the project list to the browser: dropping a folder into the projects directory makes it appear in the list after a refresh, and only the immediate child directories of the root ever show up. Every path is canonicalized and re-checked against the root so a symlink or `..` can never escape the allowlist.

**Blocked by:** 02

**Status:** resolved

- [x] `GET /healthz` responds `200` without auth.
- [x] `GET /api/projects` returns exactly `200 { projects: Project[] }`, ordered alphabetically by `name`.
- [x] The projects root comes from `PROJECTS_ROOT` env var with a config-file fallback; a missing/unreadable/empty root returns `200 { projects: [] }`, never a 500.
- [x] Discovery re-scans on every request (no cache); `id` = base64url of the canonical path, `name` = basename.
- [x] Dotfile directories, plain files, and symlinks whose realpath resolves outside the root are excluded; empty directories are included.
- [x] `canonicalizeInsideRoot` is the single allowlist seam: it realpath-resolves both root and candidate and returns the canonical path only when it lies inside the root; decoding an id is never treated as authorization.
- [x] An integration test boots the real HTTP handler against a temporary projects root and asserts the exact `{ projects: [...] }` shape, alphabetical order, dotfile/non-dir/symlink-escape exclusion, empty-dir inclusion, and `GET /healthz` 200.
- [x] A focused unit test exhaustively covers `canonicalizeInsideRoot`: in-root path accepted, `..` traversal rejected, symlink-to-outside rejected, symlink-to-inside accepted, non-existent path rejected — against real temp directories (no `fs` mocking).

## What landed

```
server/src/allowlist.ts   createAllowlist(root).canonicalizeInsideRoot() + isInsideRoot()  — the security seam
server/src/discovery.ts   createProjectDiscovery(root).listProjects(): Project[]           — the filesystem seam
server/src/config.ts      loadConfig(): PROJECTS_ROOT, else the config file's projectsRoot
server/src/app.ts         buildApp({ projects }) — Fastify, /healthz + the /api scope, not listening
server/src/main.ts        boot: loadConfig -> discovery -> buildApp -> listen (PORT, HOST)
```

- `canonicalizeInsideRoot` `realpath`s **both** sides per call (so a `..` segment or a symlink cannot
  escape by spelling) and decides containment with `path.relative` — which also gets Windows
  separators/drive letters right, and still accepts a sibling merely *named* `..foo`. Every failure
  to resolve (ENOENT, EACCES, symlink loop) is a rejection.
- Discovery does one `readdir` per request and filters: skip dotdirs, skip non-directories, skip
  symlinks that escape, skip anything the allowlist resolves to a non-directory (a link to a file).
  In-root symlinks are listed under their own name with `path` = the real target.
- `/api/**` is registered as an encapsulated Fastify scope so wayfinder 07's principal-aware hook
  drops in front of it without touching the routes. This slice ships it unauthenticated, so
  `main.ts` binds loopback by default (`HOST` overrides for the container).
- Ordering is `localeCompare` on the name (human alphabetical, per user story 9).
- **A directory is listed exactly once.** Because the id *is* the canonical path, a symlink pointing
  at a sibling (`alpha-alias → alpha`) would otherwise produce two rows sharing one id — a React key
  collision, and one click selecting both. Real children are visited before symlinks, so a directory
  keeps its own name and an alias never shadows it. Found by the code review, fixed with a test.
- Known and deliberate: an in-root symlink is listed under the **link's** name (what the user sees)
  while `path` is the real target; and a symlink resolving to the root itself is not special-cased —
  the root is inside the allowlist by definition, and nothing in the ticket excludes it.

## Evidence

```
npm test          → server: 15 passed | 1 skipped; shared 6; web 2
npm run typecheck → clean; npm run build → clean
```

The skipped test is the symlink-to-a-file case: creating a file symlink needs elevation or
Developer Mode on Windows, so it runs on POSIX only (`it.skipIf(win32)`); the junction-based
directory cases run everywhere.

End-to-end against a real temp root (`PROJECTS_ROOT=… PORT=3101 node server/dist/main.js`):

```
GET /healthz        → 200 {"status":"ok"}
GET /api/projects   → 200 {"projects":[alpha, escape, zulu]}   (dotdir .hidden and loose.txt excluded;
                                                                escape was a real copied dir, not a link)
ids                 → base64url tokens that decode back to each canonical path
```

The TDD loop ran at the two pre-agreed seams: the allowlist unit (red → green per case: accept,
traversal, missing, symlink-in, symlink-out, dotted sibling) and the HTTP boundary (red → green per
behavior: healthz, shape/order, exclusions, missing root, no-cache rescan, env config, config file,
malformed config).
