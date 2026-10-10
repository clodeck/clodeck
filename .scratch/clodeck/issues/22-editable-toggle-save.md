# 22: Editable toggle + save

**What to build:** The file preview starts **read-only** and flips to a writable `<textarea>` with Save/Cancel — content editing. Save overwrites the existing file on disk through a new `POST /files/save` route (a deliberate overwrite, distinct from `PUT /files/content`'s create-only upload). The edit area is larger than the read-only preview.

**Blocked by:** 21

**Status:** resolved

- [x] `server/src/files/scoped-fs.ts` adds `overwriteFile(target, content)` and a `WriteResult` arm `not_a_file`. It `lstat`s the final segment — missing → `not_found`, symlink → `symlink`, anything not a regular file → `not_a_file` — then a plain truncating `writeFile`.
- [x] `server/src/files/transport.ts` adds `POST /projects/:id/files/save` (raw octet-stream, `bodyLimit: MAX_UPLOAD_BYTES`, the shared `openProject`/`relPath` preamble) → `200` / `404` / `400` / `413`. `writeOutcome` maps `not_a_file → 400`.
- [x] `web/src/files/transport.ts` adds `saveUrl` + `saveContent` (`POST`, `content-type: application/octet-stream`, string body).
- [x] `web/src/files/reducer.ts` adds a `PreviewState` arm `editing` (carrying `path`/`name`/`original`/`value`/`dirty`/`saving`/`error`) and an `error` arm, plus the pure transitions `beginEdit`/`updateEdit`/`savingEdit`/`savedEdit`/`saveFailedEdit`/`cancelEdit` and `previewPath`.
- [x] `web/src/files/FilePanel.tsx` adds the read-only ⇄ writable header (an "Edit" toggle on text files, withheld for truncated ones) and the editing `<textarea>` with Save/Cancel; the edit pane is `max-h-[75%]` vs the read-only `45%`.
- [x] `npm run typecheck` and `npm test` pass.

## What landed

```
server/src/files/scoped-fs.ts   overwriteFile + WriteResult.not_a_file (guard hardened to `!isFile()`: a FIFO/socket
                                target is refused too, not just a directory).
server/src/files/transport.ts   POST /files/save; writeOutcome not_a_file → 400 "target is not a regular file".
web/src/files/transport.ts      saveUrl + saveContent.
web/src/files/reducer.ts        editing + error PreviewState arms; beginEdit/updateEdit/savingEdit/savedEdit/
                                saveFailedEdit/cancelEdit; previewPath helper.
web/src/files/useFiles.ts       edit/editValue/save/cancel/dismiss actions; save() → saveContent → savedEdit/saveFailedEdit.
web/src/files/FilePanel.tsx     read-only ⇄ writable header + textarea + Save/Cancel + bigger edit pane.
server/src/files/scoped-fs.test.ts    overwriteFile: overwrite / missing→not_found / directory→not_a_file / symlink→symlink.
server/src/files/transport.test.ts    POST /files/save: 200 / 404 / 400 (dir, symlink, bad body) / 413 + on-disk bytes.
web/src/files/reducer.test.ts         editing transitions (seed, truncated no-op, dirty, save in flight/land/fail, cancel).
web/src/files/transport.test.ts       saveUrl + saveContent (method/path/body/content-type, 404 mapping).
```

- **Save vs upload.** `PUT /files/content` stays create-only (`flag:'wx'`, never overwrites). `POST /files/save` is the
  one deliberate overwrite, and it only ever overwrites a regular file: the `lstat` refuses a symlink (`symlink`) and
  anything non-file (`not_a_file`), and `resolveWriteTarget` already refuses the root (`is_root`) and re-validates the
  parent through realpath containment. `protocol.ts` and `shared/src/files.ts` are untouched (the request is raw bytes,
  the response `{ ok: true }` / `{ error }`).
- **A truncated text file is read-only** (`beginEdit` no-ops and the toggle is withheld): the server only sent the
  256 KiB prefix, so editing it would clobber the rest. Binary files have no toggle either.
- **A failed save keeps the buffer.** `saveFailedEdit` stays in `editing` with the user's content intact and the error
  shown in the pane; `dirty = value !== original` disables a no-op Save.

## Decisions the spec did not pin

- **`dirty` is stored, not derived** — `updateEdit` computes `value !== original` at transition time, so the panel
  reads it directly. (`beginEdit` seeds it `false`.)
- **A save failure surfaces in the editing arm**, not a dialog: save has no name prompt, so the error lives on the
  editor itself.

## Evidence

```
npm run typecheck                                  → clean (shared → server → web)
npm test                                            → server 179 passed / 7 skipped; web 75 passed
npm run build                                       → clean (the >500 kB chunk notice is pre-existing, from xterm)
```
