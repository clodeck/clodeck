# 40: File rows show their real size and when they changed

**What to build:** The listing is names and folders, nothing else — you cannot tell a 200-byte config
from a 4 MB asset, or which file you touched an hour ago. The server already reports `size` and `mtime`
on every file entry; surface them.

**Blocked by:** 36

**Status:** resolved

- [x] Every file row shows its size, dim and right-aligned, in the tree as well as the flat list (41) —
      one formatting helper, not two.
- [x] The modified time is human-readable relative to now for recent changes (`2m ago`, `3h ago`,
      `yesterday`, `5d ago`) and a plain date beyond that, with the exact server timestamp in the row's
      tooltip so nothing is lost.
- [x] **Directories show neither.** The wire type carries no size or mtime for a directory, and the
      prototype's numbers for them were hashed mocks — a directory must render blank rather than a
      fabricated value.
- [x] Permissions are **not** added: the server reports none, and a permission column is noise for a
      single-user remote drawer. `spec-04`'s out-of-scope line for metadata columns is narrowed to this
      in ticket 32, not contradicted here.
- [x] A binary entry (only a size is known) still shows its size and an empty preview, as today.
- [x] Tests: the formatter is pure and unit-tested over the boundaries (bytes / KB / MB, relative vs
      absolute), and a rendered test shows a file row carrying a size and a directory row carrying none.

**Landed as:** `web/src/files/format.ts` (`formatSize`, `formatModified`) — the one helper the flat list
(41) will read the Size and Modified columns from; `FileMeta` in `web/src/files/FilePanel.tsx` renders it
on a file row only. Seen in the browser with real files: `11 B`, `43.6 KB`, `5 B`, tooltips reading
`modified 44m ago · 2026-10-12T17:41:40.611Z`, and `xcvz/` with nothing after it.

## Reference

Prototype metadata (mock, for layout only): `prototype/common.js:80-95`, per-row size at `:422`, list
columns at `:457-470`. Real data: `shared/src/files.ts:17-20` (`FileEntry` file arm has `size`,
`mtime`). Parity item: D3 #17.
