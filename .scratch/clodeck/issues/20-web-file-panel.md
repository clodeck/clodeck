# 20: Web file panel — useFiles seam + tree/preview + toolbar

**What to build:** The `Files` stub becomes a real file drawer: a `useFiles(project)` data seam (shaped like `useChat`/`useTerminal`) owning the tree state and the mutations, and a `FilePanel` that renders the directory tree, a file preview, and the toolbar (new file, new folder, upload, refresh) plus a per-row ⋯ menu (rename, delete — confirmed).

**Blocked by:** 19

**Status:** ready

- [ ] `web/src/files/useFiles.ts` exposes a discriminated `FileViewer` state union (`idle | loading | ready | error`) plus a `PreviewState` union and a `FileViewerActions` record (`open`/`up`/`refresh`/`preview`/`create`/`rename`/`remove`/`upload`).
- [ ] `web/src/files/FilePanel.tsx` replaces the `Files` stub, keyed by project id, with a breadcrumb + up, a directory listing (dirs before files, sorted), and a preview pane.
- [ ] New file / new folder / rename use an inline name prompt; delete uses a confirm modal (folder-delete warns); upload uses a file picker and posts raw bytes.
- [ ] Rendering is exhaustive (`switch` with `never` default) over `FileEntry`/`FileContent`; file content renders only as React text nodes — no `innerHTML`/`dangerouslySetInnerHTML`.
- [ ] Escaping symlinks render non-navigable; every successful mutation re-lists the current directory.
- [ ] `npm run typecheck` and `npm run build` pass; existing web tests stay green.
