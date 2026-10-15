# 55: A row's `⋯` menu always opens where you can click it

**What to build:** The last row or two of the tree open their menu below the row, into the 42vh drawer's
scroller, which clips it away — the `⋯` looks broken on exactly the rows nearest the bottom edge. The menu
should always be wholly visible: below the row where there is room, above it where there is not.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] The `⋯` on the last row of the tree — and of the flat list, which shares the row — opens a menu whose
      entries are both inside the drawer and clickable. Today the menu is drawn and clipped, so the click
      has no visible effect.
- [ ] The common case does not change: a row with room below it still opens its menu downward.
- [ ] The placement follows the space actually available, not a fixed rule — and that decision is testable
      without a browser (a pure helper, or an equivalent seam, unit-tested at the boundary), with the
      geometry itself confirmed in a real browser, because jsdom computes no boxes.
- [ ] The menu's containing block stays the row, so the placement is expressed against the row rather than
      the panel — the row's `relative` is what the current placement is built on, and it must survive.
- [ ] The corner that ticket 37's toast occupies is checked: on the drawer's last row, an open menu and a
      toast are not drawn over each other.
- [ ] Tests: the unit test above, plus the existing panel tests that open a menu by `Actions for <name>`
      staying green; the browser check is named in the landed note.

## Reference

Product: `web/src/files/FilePanel.tsx:982-1012` (the menu, `absolute top-full right-0` inside the row's
`relative`) and `:909-947` (the row); the 42vh drawer that clips it lives at `web/src/App.tsx:286`. The
prototype had no such problem — its tree was not inside a drawer — so this is ours to solve. Source: the
"Known loose ends" list in `.scratch/clodeck/handoff.md`, alongside ticket 37's toast.
