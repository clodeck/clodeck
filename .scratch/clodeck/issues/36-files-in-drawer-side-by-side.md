# 36: Inside the drawer, the file panel is tree | code, side by side

**What to build:** The file panel currently stacks its tree over its preview, so both are short and the
preview is cramped in a panel that is already only half of a column. In the prototype's drawer the two
sit side by side: a fixed 300px tree on the left, the code view filling the rest. This is the layout
every remaining file ticket (37 through 44) adds its control to, so it lands first.

**Blocked by:** 35

**Status:** ready-for-agent

- [ ] The Files tab lays out as a 300px tree column plus a code column that takes the remaining width,
      replacing the stacked arrangement — the stacked layout is not kept as a narrow fallback.
- [ ] The tree column owns the toolbar (new file, new folder, upload, refresh) and the directory
      breadcrumb, as today; it scrolls on its own and its `⋯` menu still works in a short viewport.
- [ ] The code column has a head line: the selected file's path in mono on the left, an empty action
      area on the right for the controls tickets 42 (download) and 43 (Preview ⇄ Source) add, and the
      text `no file selected` when nothing is open.
- [ ] The code column's body scrolls independently; both columns are `min-h-0` so nothing overflows the
      drawer.
- [ ] Opening a file, `up`, refresh and the project switch keep working exactly as before — this ticket
      moves pixels, it does not change the data seam.
- [ ] The tab is labelled just **Files**: the prototype's `Files · read-only` label predates the
      editable toggle, which is in MVP and shipped.
- [ ] A rendered test asserts the two columns exist side by side and that a selected file renders in the
      code column.

## Reference

Prototype: `prototype/variant-a.js:115-147` (the 300px tree plus code head: path, `size · modified ·
perm`, then Preview / download / read-only chips). Parity item: D1(a).
