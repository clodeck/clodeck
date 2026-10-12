# 41: A flat list beside the tree

**What to build:** The tree is the right default, but scanning one directory's files — sorting by size,
spotting the big one — is easier as flat rows with columns. Add the prototype's view toggle to the file
toolbar.

**Blocked by:** 36, 40 (the flat list is where the metadata columns earn their keep)

**Status:** resolved

- [x] A toolbar toggle switches the listing between the tree and a flat list, and switches back; the
      button's label/tooltip names the view it will show, as the prototype's does.
- [x] **The flat list covers the directory you are in, not the whole project.** The prototype could
      recurse because its whole file tree was in memory; this product lists one directory per request
      and has no recursive listing route, so a recursive flat view here would mean either N requests or
      a new route — neither is worth it for the lowest-value item in the parity list. Rows are the
      current directory's entries, and the breadcrumb keeps the scope visible.
- [x] Rows carry Name, Size and Modified columns (from 40's formatter/source), directories first and
      sorted as the tree already sorts them.
- [x] A row still opens the file; the `⋯` menu still offers rename and delete; upload and new file still
      target the directory being shown.
- [x] The chosen view is panel state and resets with the panel, not a persisted preference — nothing new
      is stored per project.
- [x] Tests: the toggle flips the rendering without losing the current path or selection; a rendered test
      asserts the flat list shows the columns.

**Landed as:** the toolbar's `List ⇄ Tree` button in `web/src/files/FilePanel.tsx` (`View` is
`useState` in the panel, so it dies with it) and `FlatList`/`FlatRow` beside the tree — one folder's
entries in a `Name · Size · Modified` grid, directories first out of the same `sortEntries`. The tree
and the flat list now share `ListingBody`, the four states of a `DirListing`, and each supplies only
its ready state. A folder row here *enters* the folder through the new `openDir` action (which leaves
it expanded, unlike `toggle`), and the breadcrumb — a plain `in <folder>` line in tree mode — becomes
a real `root / … / here` trail to climb back out with. The mode is not a stored preference; switching
projects re-mounts the panel and the tree is back. Seen in the browser: `evidence/41-flat-list.png`.

**One interpretation worth naming:** "the directory you are in" is the drawer's existing *active*
folder — the last folder clicked, which a collapse also sets (ticket 36's rule, unchanged here). So
collapsing `src` and then hitting `List` lists `src`, not the root.

## Reference

Prototype: `prototype/common.js:457-476` (flat list + `list-head`), `:559-564` (toggle button). Parity
item: D3 #18.
