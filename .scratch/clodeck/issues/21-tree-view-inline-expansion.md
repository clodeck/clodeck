# 21: Tree view with inline folder expansion

**What to build:** The file drawer's "current directory + breadcrumb + up" model becomes a real tree. Every loaded directory is keyed by its root-relative path (`''` = root); a folder click expands/collapses **in place** (it never navigates), and each expanded folder's listing is fetched lazily on first open. The last folder clicked is the "active" folder that New File/Folder and Upload land in.

**Blocked by:** 20

**Status:** resolved

- [x] `web/src/files/reducer.ts` re-models the drawer: `DirListing` (`loading | ready | error`), `TreeState` (`idle | loading | ready | error`; the ready arm holds `dirs`/`expanded`/`active`), and `FileViewer` folds `TreeState` + `PreviewState`. `withDir`/`withExpanded`/`withActive` are the pure tree transitions.
- [x] `web/src/files/useFiles.ts` holds the keyed-dirs map, the expanded set and the active folder; `toggle` lazy-loads a folder on first expand and reuses the cache on re-expand; `refresh` re-lists the root and every expanded folder.
- [x] `web/src/files/FilePanel.tsx` renders the recursive tree (nested indentation by depth), drops the breadcrumb/`up`, and shows the active target ("Files · in src/").
- [x] Row keys and the ⋯ menu key by the full path, not `entry.name` (the same name recurs at different depths).
- [x] Create/upload force-expand their target folder so the new entry is visible; rename/remove reset a preview of the touched path.
- [x] `npm run typecheck` and `npm test` pass.

## What landed

```
web/src/files/reducer.ts      DirListing/TreeState/FileViewer unions; idleTree/treeLoading/treeReady/treeError;
                              dirLoading/dirReady/dirError; withDir/withExpanded/withActive; viewerOf folds tree + preview.
                              Removed: ListingState, listing*, viewerPath, breadcrumb/Crumb.
web/src/files/useFiles.ts     tree state (dirs/expanded/active) + loadDir, toggle, refresh; create/upload/rename/remove
                              re-list the affected directory and force-expand / reset-preview as needed.
web/src/files/FilePanel.tsx   recursive TreeLevel; rows keyed by path; active-dir hint in the header; no breadcrumb.
web/src/files/reducer.test.ts tree + preview + editing transitions (sorted listing, expand/collapse, active, viewerOf).
```

- **Lazy per-directory:** a folder's listing is fetched once, on first expand; collapse + re-expand reuses the cache
  (no re-fetch), and `refresh` re-lists the root and every currently expanded folder.
- **The active folder** is set on every folder click (prototype parity: `row.onclick` both toggled `kids.hidden` and
  called `setActiveDir`), and is the create/upload target. It defaults to the root.
- **Indentation is by depth** via an inline `paddingLeft` (Tailwind can't emit dynamic depth classes); keys and menu
  state use the full `joinPath(dir, name)` so same-named entries at different depths don't collide.

## Decisions the spec did not pin

- **Tree state shape.** `dirs` is a `Record<path, DirListing>` (not an array), `expanded` a `Record<path, true>`, and
  `active` a single path. The top-level `idle/loading/error` arms mirror the *root's* fetch; a failed sub-directory
  fetch is a `DirListing` error arm shown inline under that folder, not a whole-drawer collapse.
- **Mutation success re-lists the affected directory** (`loadDir(parent)`), and create/upload force-expand the target
  folder; a failure rejects so the panel keeps its dialog open with the server's message (ticket 20's
  whole-drawer error arm is gone).

## Evidence

```
npm run typecheck                                  → clean (shared → server → web)
npm test                                            → server 179 passed / 7 skipped; web 75 passed
npm run build                                       → clean (the >500 kB chunk notice is pre-existing, from xterm)
```
