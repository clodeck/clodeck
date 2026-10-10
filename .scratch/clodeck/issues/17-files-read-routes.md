# 17: Files read routes — GET listing + GET content

**What to build:** The read half of the file REST surface, registered inside the app's existing `/api` scope: `GET /api/projects/:id/files` (directory listing) and `GET /api/projects/:id/files/content` (file content). `:id` re-enters `resolveProject`; `?path=` is a relative path that is syntax-checked then handed to `ScopedFs.resolve`.

**Blocked by:** 16

**Status:** resolved

- [x] `server/src/files/transport.ts` exports `registerFileRoutes(api, { projects })`, registered in `buildApp`'s `/api` scope next to sessions and terminal-size (no `buildApp` signature change).
- [x] `GET /projects/:id/files?path=` → `{ entries: FileEntry[] }`; empty/omitted `path` = project root.
- [x] `GET /projects/:id/files/content?path=` → `{ content: FileContent }`.
- [x] `readRelPath` rejects absolute paths, drive letters, and any `.`/`..`/empty/NUL segment → `400`.
- [x] Status mapping: unknown project / not-found / outside-root → `404`; path not a directory (listing) or not a file (content) → `400`; binary content is `200`, not an error.
- [x] Inject tests build the app against a temp root (`createSandbox` + `createProjectDiscovery`) and assert shapes and codes, including `..` and symlink-escape refusal.

## What landed

```
server/src/files/transport.ts     registerFileRoutes: GET /files + GET /files/content, readRelPath
server/src/app.ts                 registerFileRoutes(api, { projects }) inside the /api scope
server/src/files/transport.test.ts  8 inject() tests against a real temp root
```

- `readRelPath` is the early syntactic refusal (absolute / drive-letter / `..`/`.`/empty / NUL / backslash
  separators → 400); the real boundary remains `ScopedFs.resolve`'s realpath containment.
- Both routes re-enter through `resolveProject` (id → canonical path) before touching the reader.

## Evidence

```
npm run typecheck --workspace @clodeck/server      → clean
npm run test --workspace @clodeck/server -- --run src/files  →  20 passed (2 files)
```
