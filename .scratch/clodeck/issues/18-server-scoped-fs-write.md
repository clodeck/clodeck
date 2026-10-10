# 18: ScopedFs write half — branded FileName, create/rename/remove

**What to build:** The write half of `ScopedFs`. A second brand, `FileName`, is the only type write methods accept for a *name* (one clean segment), and `resolveWriteTarget` is the only door: it scopes the parent directory (realpath-contained) and validates the basename. Writes never follow a symlink in the final segment, never overwrite, and can never touch the project root.

**Blocked by:** 16

**Status:** ready

- [ ] `scoped-fs.ts` adds the `FileName` brand + `name()` validator (rejects `/`, `\`, `.`, `..`, NUL, empty, over-length) and `WriteTarget` / `WriteTargetResult` / `WriteResult`.
- [ ] `resolveWriteTarget(rel)` splits dirname/basename: empty → `is_root`; dirname must resolve to an in-root directory; basename must be a `FileName`.
- [ ] `createFile(target, content)` and `createDirectory(target)` — `lstat` the target first (symlink → `symlink`, existing → `exists`), then create with `flag:'wx'` / non-recursive `mkdir` (no follow, no overwrite).
- [ ] `rename(target, newName)` and `remove(target)` — `lstat` → `not_found` when absent; otherwise rename/`rm` (a symlink is renamed/removed as the link itself, never followed).
- [ ] `remove`/`rename` refuse the root (guaranteed by `resolveWriteTarget`'s `is_root`); no write touches a path outside the root.
- [ ] Unit tests against real temp dirs: create file/dir, create-existing (`exists`), create-through-symlink (`symlink`), rename, rename-missing (`not_found`), remove, remove-missing, remove/rename-root (`is_root`), invalid name.
