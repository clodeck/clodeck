# 20: Web file panel — useFiles seam + tree/preview + toolbar

**What to build:** The `Files` stub becomes a real file drawer: a `useFiles(project)` data seam (shaped like `useChat`/`useTerminal`) owning the tree state and the mutations, and a `FilePanel` that renders the directory tree, a file preview, and the toolbar (new file, new folder, upload, refresh) plus a per-row ⋯ menu (rename, delete — confirmed).

**Blocked by:** 19

**Status:** resolved

- [x] `web/src/files/useFiles.ts` exposes a discriminated `FileViewer` state union (`idle | loading | ready | error`) plus a `PreviewState` union and a `FileViewerActions` record (`open`/`up`/`refresh`/`preview`/`create`/`rename`/`remove`/`upload`).
- [x] `web/src/files/FilePanel.tsx` replaces the `Files` stub, keyed by project id, with a breadcrumb + up, a directory listing (dirs before files, sorted), and a preview pane.
- [x] New file / new folder / rename use an inline name prompt; delete uses a confirm modal (folder-delete warns); upload uses a file picker and posts raw bytes.
- [x] Rendering is exhaustive (`switch` with `never` default) over `FileEntry`/`FileContent`; file content renders only as React text nodes — no `innerHTML`/`dangerouslySetInnerHTML`.
- [x] Escaping symlinks render non-navigable; every successful mutation re-lists the current directory.
- [x] `npm run typecheck` and `npm run build` pass; existing web tests stay green.

## What landed

```
web/src/files/reducer.ts          FileViewer / PreviewState unions, pure transitions, path helpers, sorting, isValidName
web/src/files/transport.ts        the four /api/projects/:id/files endpoints + response/status mapping + wire guards
web/src/files/useFiles.ts         the data seam: listing effect, preview with a race token, mutations that re-list
web/src/files/FilePanel.tsx       the drawer: toolbar, breadcrumb + up, listing, ⋯ menu, preview, name/confirm modals
web/src/files/reducer.test.ts     17 tests — sorting, paths, listing/preview transitions, viewerOf
web/src/files/transport.test.ts   14 tests — URLs, decoding, guards, 404/409/413 mapping, upload body
web/src/App.tsx                   Files stub → <FilePanel key={project.id} project={project} />; the dead Stub removed
```

- The listing is a `useEffect` keyed on `[project.id, path, attempt]` (the `useProjects`/`useSessions` idiom); a
  mutation success bumps `attempt`, which is what re-lists the current directory. `path` is always relative to the
  project root (`''` = root); no absolute path or decoded id is held client-side.
- The preview is its own `fetch` stamped with a monotonically increasing token, so a slow read of file A cannot land
  on top of a newer read of file B (or after the directory changed).
- Every `switch` over a closed union ends in a `never` default (`assertNever`): `ViewerBody` (viewer status),
  `EntryMain` (entry type), `PreviewPane` (preview kind), and `previewOf` (file content kind). A new arm is a
  compile error at the renderer, not a silently missed branch.
- File content is a React text node (`<pre>{preview.content}</pre>`); `grep -rn 'innerHTML|dangerouslySetInnerHTML'
  web/src` finds only two comment lines, no usage. An escaping `symlink` row is a plain `<span>`, never a button.

## Decisions the spec did not pin

- **Action path semantics.** `open`/`preview`/`remove`/`upload` take a *root-relative* path (as the REST `?path=`
  does); `create` takes a bare `name` joined to the current directory; `rename` takes a root-relative `path` and a
  bare `to`. The panel builds the paths it passes with the reducer's exported `joinPath`.
- **Mutation failures** use the union's own `error` arm (`{ status:'error'; path; message }`), which is the only
  error surface the spec pins; a `409`/`413`/`400` is surfaced there, not thrown, and `Refresh` recovers the
  listing. No extra field was added to `FileViewer`, `PreviewState`, or `FileViewerActions`.
- **Drag-and-drop** onto the listing is wired as well (spec §"Web client" mentions it beside the picker); the picker
  is the ticket's required path.
- **Preview is not dismissable directly** — navigating, `up`, or `refresh` resets it (the effect resets the preview),
  since `FileViewerActions` pins no close action.

## Evidence

```
npm run typecheck                                  → clean (shared → server → web)
npm run test --workspace @clodeck/web              → 65 passed (5 files); 31 of them new in src/files
npm run build --workspace @clodeck/web             → built in 350ms (tsc + vite; the >500 kB chunk notice is pre-existing, from xterm)
```
