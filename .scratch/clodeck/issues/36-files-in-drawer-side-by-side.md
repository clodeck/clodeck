# 36: Inside the drawer, the file panel is tree | code, side by side

**What to build:** The file panel currently stacks its tree over its preview, so both are short and the
preview is cramped in a panel that is already only half of a column. In the prototype's drawer the two
sit side by side: a fixed 300px tree on the left, the code view filling the rest. This is the layout
every remaining file ticket (37 through 44) adds its control to, so it lands first.

**Blocked by:** 35

**Status:** resolved

- [x] The Files tab lays out as a 300px tree column plus a code column that takes the remaining width,
      replacing the stacked arrangement — the stacked layout is not kept as a narrow fallback.
- [x] The tree column owns the toolbar (new file, new folder, upload, refresh) and the directory
      breadcrumb, as today; it scrolls on its own and its `⋯` menu still works in a short viewport.
- [x] The code column has a head line: the selected file's path in mono on the left, an empty action
      area on the right for the controls tickets 42 (download) and 43 (Preview ⇄ Source) add, and the
      text `no file selected` when nothing is open.
- [x] The code column's body scrolls independently; both columns are `min-h-0` so nothing overflows the
      drawer.
- [x] Opening a file, `up`, refresh and the project switch keep working exactly as before — this ticket
      moves pixels, it does not change the data seam.
- [x] The tab is labelled just **Files**: the prototype's `Files · read-only` label predates the
      editable toggle, which is in MVP and shipped.
- [x] A rendered test asserts the two columns exist side by side and that a selected file renders in the
      code column.

## Reference

Prototype: `prototype/variant-a.js:115-147` (the 300px tree plus code head: path, `size · modified ·
perm`, then Preview / download / read-only chips). Parity item: D1(a).

## What landed

```
web/src/files/FilePanel.tsx      Two columns: `w-[300px] shrink-0` tree (breadcrumb + toolbar + the
                                 tree scroller) beside a `min-w-0 flex-1` code column (head + body).
                                 PreviewPane became CodeHead (path, or `no file selected`) + CodeActions
                                 (the note and Edit / Cancel / Save) + PreviewBody (the bytes, the
                                 binary line, or the editor); PreviewFrame is gone.
web/src/files/FilePanel.test.tsx new: one rendered test over the real `useFiles` seam — two sibling
                                 columns of one row, the toolbar in the tree, `no file selected` in the
                                 code column, and a clicked file's bytes rendering there, not under
                                 the tree.
```

Two things beyond the literal checklist, both in service of its own clauses:

1. **The breadcrumb moved onto its own line above the toolbar.** Four labelled buttons (~237px) plus a
   path do not fit across 300px, and the path is the one item the reader cannot do without; the button
   row also wraps, so a later ticket's fifth control degrades rather than overflowing.
2. **`EntryRow` is now `relative`.** Its menu was positioned against the whole panel, so `top-full` put
   it below the panel — and the tree scroller clipped *that*, so `⋯` opened nothing at all. The row is
   its own positioning context now; the browser check reads the menu's box at `x=503, y=690` inside the
   tree column.

The action area is not empty: the edit toggle's own controls live there, since the pane header that
carried them is gone. Tickets 42 and 43 add theirs beside them.

## Evidence

`npm run typecheck`, `npm test` (web 96 in 11 files) and `npm run build` green; `npm run e2e` green.
Driven by hand in the same browser loop: the Files tab at 1440×900 and at 1000×700, with a file open,
flipped to the editor, and the row menu open.

## Known gaps

- **A row near the bottom of the tree still opens its menu off the scroller's edge.** The menu hangs
  below its row now, so it is clipped only when there is no room under it — the drawer is 42vh. Flipping
  the menu upward for the lower half of the viewport is a real fix and not this ticket's.
- **The tree column's width is fixed at 300px** with no splitter; the prototype has none either.
