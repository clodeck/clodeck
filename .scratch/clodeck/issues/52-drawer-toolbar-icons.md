# 52: The drawer's toolbar is icons

**What to build:** The tree column's toolbar is five text buttons — `New File`, `New Folder`, `Upload`,
`Refresh`, and the view toggle — which is the widest thing in a 300px column and already wraps to a second
line. The prototype's toolbar was a row of icon buttons with tooltips. Adopt that, on one icon vocabulary
shared with the rail.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The five actions are icon buttons in a single row that does not wrap at the drawer's 300px column,
      each with a hit area no smaller than today's button.
- [x] **Every action keeps the accessible name it has today** — `New File`, `New Folder`, `Upload`,
      `Refresh`, and the view toggle's `List` ⇄ `Tree`. The tests that click the toolbar by name therefore
      pass unchanged, and that is the check that no action lost its name to a picture.
- [x] The context that only the visible text carried moves to the tooltip and is not lost: the folder a
      create lands in, the upload cap, and what the view toggle switches to.
- [x] **One icon vocabulary.** The rail's three shapes and the toolbar's five come from one module, drawn
      the same way — same stroke, same size, `aria-hidden` on the same terms — rather than a second
      hand-rolled set grown beside `RailIcon`. The prototype kept its icons in one map, and the toolbar is
      what makes that map worth having.
- [x] **Words that carry meaning stay words.** The empty state, the dialogs, the row notes, the truncated
      and binary notes and the error surfaces keep their text. This ticket changes the toolbar's chrome
      only.
- [x] Tests: the existing toolbar tests (by name) pass unchanged; a rendered test asserts every toolbar
      button has a non-empty accessible name, so a future icon cannot arrive unlabelled.

**Landed as:** `web/src/icons.tsx` — one map of eight shapes drawn by one `<Icon>` on one stroke scale, the
rail's three moved in beside the toolbar's five, so `RailIcon` is gone and `App.tsx` draws the rail from the
same import. The tree column's toolbar is five 32px squares on one line in a labelled `group`
(`File actions`), each keeping the accessible name it had and taking the old visible text's context into
its `title`.

The target is worth stating plainly, because it is the one place the criterion and the icon idiom pull
apart: 32px across is *narrower* than the widest text button it replaced (`New Folder` was ~61px) and half
again as tall (those were 21px). Width is what the icon idiom spends — the prototype's `.icon-btn` is 30px
and ticket 49's rail is 36px — and height is what it buys; the row no longer wraps.

## Reference

Prototype: `prototype/common.js:33-60` (the `ICONS` map — `upload`, `filePlus`, `folderPlus`, `refresh`,
`list`, `folder`), `:546-566` (`buildToolbar` and its `btn(icon, title, onclick)`), and
`prototype/styles.css:54-59` (`.icon-btn`, 30px, radius 7, `hover` at bg-3, `.on` at bg-4). Product:
`web/src/files/FilePanel.tsx:301-311` (the `flex-wrap` row) and `:1357` (`ToolbarButton`), with the rail's
hand-rolled icons at `web/src/App.tsx:226-280`. Parity item: P2 #9.
