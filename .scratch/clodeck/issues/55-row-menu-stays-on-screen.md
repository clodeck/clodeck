# 55: A row's `⋯` menu always opens where you can click it

**What to build:** The last row or two of the tree open their menu below the row, into the 42vh drawer's
scroller, which clips it away — the `⋯` looks broken on exactly the rows nearest the bottom edge. The menu
should always be wholly visible: below the row where there is room, above it where there is not.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The `⋯` on the last row of the tree — and of the flat list, which shares the row — opens a menu whose
      entries are both inside the drawer and clickable. Today the menu is drawn and clipped, so the click
      has no visible effect.
- [x] The common case does not change: a row with room below it still opens its menu downward.
- [x] The placement follows the space actually available, not a fixed rule — and that decision is testable
      without a browser (a pure helper, or an equivalent seam, unit-tested at the boundary), with the
      geometry itself confirmed in a real browser, because jsdom computes no boxes.
- [x] The menu's containing block stays the row, so the placement is expressed against the row rather than
      the panel — the row's `relative` is what the current placement is built on, and it must survive.
- [x] The corner that ticket 37's toast occupies is checked: on the drawer's last row, an open menu and a
      toast are not drawn over each other.
- [x] Tests: the unit test above, plus the existing panel tests that open a menu by `Actions for <name>`
      staying green; the browser check is named in the landed note.

**Landed as:** `web/src/files/placement.ts` — **new**: the pure `menuPlacement(row, clip, menuHeight,
gap)`, the `Span` it reads a box as, the `MenuPlacement` it answers with, and `MENU_GAP`. The decision
lives there, apart from the reading of the boxes, because jsdom computes no layout at all: the panel
supplies the three numbers and that file decides what they mean. `web/src/files/FilePanel.tsx` grows
`spanOf(element)` (a `getBoundingClientRect` as a `Span`) and `clipOf(row)` — the row's nearest scrolling
ancestor, the tree column's `overflow-y-auto` scroller, or the page where there is none, since a menu
drawn past that edge is cut off rather than overlapped — and `EntryActions` grows a `useLayoutEffect`
that runs with the menu already in the DOM and before the browser paints, setting the placement from the
row's span, the clip's span and the menu's own height — and setting it again on a scroll of that
scroller, since the room is the clip's edge against a row that travels. The menu is otherwise the element
it was: still a
direct child of the row's `relative`, still `absolute right-0 z-20 w-32`, with only the edge it hangs
from moving (`top-full mt-1` ⇄ `bottom-full mb-1`). `top-full` and `bottom-full` therefore still measure
from the row and not the panel — bullet 4's containing block — and the one change serves both listings,
whose rows share `EntryActions`.

**Tests:** `web/src/files/placement.test.ts` — **new**: six cases at the boundary jsdom cannot cross (room
below → downward; exactly enough room below → still downward, one pixel less → up; the gap counted on the
side it opens to; the drawer's last two rows → up; neither side fitting → the roomier one, ties
downward; every box zero, as jsdom's are → the downward default). `web/src/files/FilePanel.test.tsx`
gains the containing-block pin: the menu is still a direct child of its row, still `absolute`, still
`top-full` by default. The existing `Actions for <name>` tests are untouched and green.

**The browser check — named, and owed.** The one thing no rendered test can see is where the boxes land,
and no browser could be driven in the sandbox this landed in: `npx playwright install chromium` fails on
this network, which is why the repo's own `web/playwright.config.ts` drives the machine's own Chrome
instead — and that sandbox has none. The check, named so it can be run where one exists: with the dev
loop up, open a project whose tree scrolls in the drawer's Files tab, scroll to the foot, and click the
`⋯` on the last row — both entries are wholly inside the drawer and clickable — then on the row above it,
which opens downward.

**Ticket 37's toast corner, checked:** the menu's foot now sits at the row's own top, so the last row's
menu opens above the row and out of the toast's corner. A long two-line toast still reaches far enough
left to cross the foot of that menu on a viewport under about 1500px — exactly as it already covers the
tree's last rows themselves — and the toast is `pointer-events-none`, so every entry stays clickable
there and the toast keeps the place above the drawer that ticket 37 gave it.

## Code review

Both axes over the branch (Standards: `AGENTS.md`, `.sandcastle/CODING_STANDARDS.md`, and the idiom of
the file the change lands in; Spec: the six bullets above and the reason each was asked for). The code
comes back clean on both axes: the placement is pure and tested where it can be, the reading of the boxes
is two named helpers rather than a blob in the effect, no type was widened and no cast was added, and
nothing outside the two listings' shared `EntryActions` was touched. What the Spec axis found was in the
record rather than the code: bullet 6 asks for the browser check to be named in the landed note, and the
first pass left the bullets unchecked and the note in the commit message — where the ticket, the spec of
record and the first thing the next session reads, does not carry it.

Fixed in this pass:

1. **This ticket's record**: the bullets are checked, the landed note names the browser check (and why
   it is owed), and this section says what the review found.
2. **The rule's one dense call.** `setPlacement(menuPlacement(spanOf(row), clipOf(row),
   panel.getBoundingClientRect().height, MENU_GAP))` read a box in the middle of four nested calls; the
   menu's height is a line of its own now, so the call is the three numbers the rule takes and the three
   readings sit together.
3. **The Reference block's line numbers.** The menu and the row it points at moved with this change, and
   the drawer's own row moved with tickets 49 and 50; all three point at the file again.
4. **A scroll under an open menu.** A second pass over the branch (two axes, after the loop's own review)
   found the effect's comment — "it moves the row and the scroller together, so the room on either side is
   the same afterwards" — to be simply false, and the decline below resting on it. The room is the
   scroller's edge *against the row*, so it narrows as the row scrolls toward it: a menu opened with room
   below ends up cut off by its own scroller once the tree moves, which is bullet 1's failure by a second
   route. The effect re-measures now, on a capture-phase `scroll` listener that hears the drawer's own
   scroller without hunting for the element that owns it, and the listener goes when the menu does. jsdom
   has no boxes for the `answer` to move, so the test pins the question being asked again — and not asked
   once the menu is closed.

Declined on purpose:

- **`MENU_GAP` and the `mt-1` / `mb-1` classes are the same 4px written twice** — Tailwind's scale on one
  side, the pure rule's parameter on the other. One number would mean giving up either the classes or the
  parameter, and the drift a future edit could cause is the last row's 4px. The constant's own comment
  says which classes carry it, and the app sets no root font size, so `mt-1` is 4px.
- **A resize while a menu is open leaves the placement as it was read.** A resize moves the room, but
  re-measuring it means a `resize` listener on a surface that lives for seconds — and unlike a scroll,
  which the pointer can drive while the menu is up, a resize is not something the user does *to* the
  drawer. The scroll case is fixed above; this one stays a known gap.
- **`clipOf`'s fallback to `document.documentElement`.** Unreachable in the app, where a row always has
  the tree column's scroller above it; in jsdom it is what keeps every box at zero, which is what leaves
  the panel's own menu tests on the downward default.
- **The panel test's class-name assertions** (`relative`, `absolute`, `top-full`) are what
  `.sandcastle/CODING_STANDARDS.md` calls an implementation detail. With no boxes to measure, the
  containing block has no other handle, and the test's own comment says why it is the one that works.

## Reference

Product: `web/src/files/FilePanel.tsx:1057-1078` (the menu, `absolute top-full right-0` inside the row's
`relative`) and `:935-959` (the row); the 42vh drawer that clips it lives at `web/src/App.tsx:317-320`. The
prototype had no such problem — its tree was not inside a drawer — so this is ours to solve. Source: the
"Known loose ends" list in `.scratch/clodeck/handoff.md`, alongside ticket 37's toast.
