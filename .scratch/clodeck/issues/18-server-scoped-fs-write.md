# 18: ScopedFs write half — branded FileName, create/rename/remove

**What to build:** The write half of `ScopedFs`. A second brand, `FileName`, is the only type write methods accept for a *name* (one clean segment), and `resolveWriteTarget` is the only door: it scopes the parent directory (realpath-contained) and validates the basename. Writes never follow a symlink in the final segment, never overwrite, and can never touch the project root.

**Blocked by:** 16

**Status:** resolved

- [x] `scoped-fs.ts` adds the `FileName` brand + `name()` validator (rejects `/`, `\`, `.`, `..`, NUL, empty, over-length) and `WriteTarget` / `WriteTargetResult` / `WriteResult`.
- [x] `resolveWriteTarget(rel)` splits dirname/basename: empty → `is_root`; dirname must resolve to an in-root directory; basename must be a `FileName`.
- [x] `createFile(target, content)` and `createDirectory(target)` — `lstat` the target first (symlink → `symlink`, existing → `exists`), then create with `flag:'wx'` / non-recursive `mkdir` (no follow, no overwrite).
- [x] `rename(target, newName)` and `remove(target)` — `lstat` → `not_found` when absent; otherwise rename/`rm` (a symlink is renamed/removed as the link itself, never followed).
- [x] `remove`/`rename` refuse the root (guaranteed by `resolveWriteTarget`'s `is_root`); no write touches a path outside the root.
- [x] Unit tests against real temp dirs: create file/dir, create-existing (`exists`), create-through-symlink (`symlink`), rename, rename-missing (`not_found`), remove, remove-missing, remove/rename-root (`is_root`), invalid name.

## What landed

```
server/src/files/scoped-fs.ts       FileName brand, name() validator, WriteTarget/WriteTargetResult/WriteResult, resolveWriteTarget, createFile, createDirectory, rename, remove; ScopedFs gains the write methods
server/src/files/scoped-fs.test.ts  write-half describe block (POSIX-only symlink guards via it.skipIf(win32))
```

- `name()` is the compile-time fence (exported, `FileName | null`) and is re-run on the wire string at
  runtime: empty / `.` / `..` / a separator / a NUL / over 255 bytes → `null`.
- `resolveWriteTarget` is the write door: it realpath's the parent (so the parent is in-root, a real
  directory, and symlink-free) and runs the basename through `name()`; the empty path is `is_root`, so no
  `WriteTarget` ever names the root — and every write op joins `parent`/`name`, so the root is unreachable
  by construction.
- `createFile` uses `flag:'wx'` (O_CREAT|O_EXCL) and `createDirectory` a non-recursive `mkdir`, each after
  an `lstat` that folds a final-segment symlink to `symlink` and any existing entry to `exists`; a losing
  EEXIST race is folded to `exists` too.
- `remove` uses `rm(..., { recursive: existing.isDirectory(), force: true })`, so a directory symlink is
  unlinked as a link and never recursed through; `rename` renames the entry in place.

## Evidence

```
npm run typecheck --workspace @clodeck/server                  →  clean
npm run test --workspace @clodeck/server -- --run src/files    →  40 passed | 3 skipped (2 files)
npm run test --workspace @clodeck/server                       →  147 passed | 4 skipped (14 files)
```

(The 3 skipped in the focused run are this ticket's POSIX-only symlink-in-window guards, `it.skipIf(win32)`.)

