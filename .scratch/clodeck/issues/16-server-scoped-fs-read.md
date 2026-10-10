# 16: ScopedFs read half — branded ScopedPath, resolve/listDir/readFile

**What to build:** The root-scoped filesystem reader. A branded `ScopedPath` is the only type `listDir`/`readFile` accept, and the only way to make one is `resolve()`, which re-validates the joined path through realpath containment (the allowlist seam) before it returns. This is the read foundation the routes (17) hang off — no route here yet.

**Blocked by:** 15

**Status:** resolved

- [x] `server/src/files/scoped-fs.ts` declares the `ScopedPath` brand (`declare const scoped: unique symbol`), `ResolveResult`, the `ScopedFs` interface, and `createScopedFs(projectPath)`.
- [x] `resolve(rel)` joins against the project path, `realpath`s, confirms containment inside the root, and stats the result — returning `{ status:'ok'; scoped; kind }` or `{ status:'not_found' }` / `{ status:'outside_root' }`. It never throws.
- [x] `listDir(dir: ScopedPath)` lists one directory; entries resolve to `FileEntry` (dirs before files, name-ascending), and a symlink that stays inside the root is followed while one that escapes (or is broken) is reported as `type:'symlink'`.
- [x] `readFile(file: ScopedPath)` reads at most 256 KiB, detects binary (NUL / invalid UTF-8) and returns `FileContent` (`truncated` set when the file is larger).
- [x] `ScopedFs` carries read methods only — no write, no route, no `buildApp` change.
- [x] Unit tests drive the reader against real temp dirs (`createSandbox`): nested dirs, file, symlink-inside (followed), symlink-outside (escape), broken symlink, binary, truncation, `..` → outside root.

## What landed

```
server/src/files/scoped-fs.ts     ScopedPath brand, ResolveResult, ScopedFs (read half), createScopedFs
server/src/files/scoped-fs.test.ts  12 tests against real temp dirs
```

- The containment check is the allowlist's `path.relative` rule, inlined in the reader because it needs
  to *distinguish* `outside_root` from `not_found` while `allowlist.canonicalizeInsideRoot` folds both
  into `null`.
- `readFile` opens the file and reads only `min(size, 256 KiB)` — a huge file is never fully loaded, and
  `truncated` is derived from `stat().size`, not from bytes actually read.

## Evidence

```
npm run test --workspace @clodeck/server -- --run src/files/scoped-fs.test.ts  →  12 passed
```
