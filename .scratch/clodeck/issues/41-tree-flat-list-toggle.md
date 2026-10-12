# 41: A flat list beside the tree

**What to build:** The tree is the right default, but scanning one directory's files — sorting by size,
spotting the big one — is easier as flat rows with columns. Add the prototype's view toggle to the file
toolbar.

**Blocked by:** 36, 40 (the flat list is where the metadata columns earn their keep)

**Status:** ready-for-agent

- [ ] A toolbar toggle switches the listing between the tree and a flat list, and switches back; the
      button's label/tooltip names the view it will show, as the prototype's does.
- [ ] **The flat list covers the directory you are in, not the whole project.** The prototype could
      recurse because its whole file tree was in memory; this product lists one directory per request
      and has no recursive listing route, so a recursive flat view here would mean either N requests or
      a new route — neither is worth it for the lowest-value item in the parity list. Rows are the
      current directory's entries, and the breadcrumb keeps the scope visible.
- [ ] Rows carry Name, Size and Modified columns (from 40's formatter/source), directories first and
      sorted as the tree already sorts them.
- [ ] A row still opens the file; the `⋯` menu still offers rename and delete; upload and new file still
      target the directory being shown.
- [ ] The chosen view is panel state and resets with the panel, not a persisted preference — nothing new
      is stored per project.
- [ ] Tests: the toggle flips the rendering without losing the current path or selection; a rendered test
      asserts the flat list shows the columns.

## Reference

Prototype: `prototype/common.js:457-476` (flat list + `list-head`), `:559-564` (toggle button). Parity
item: D3 #18.
