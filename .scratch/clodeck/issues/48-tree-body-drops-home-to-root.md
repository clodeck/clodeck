# 48: Drop a file on the tree's own body to bring it home to the root

**What to build:** Ticket 44 gave a file dragged out of a subfolder exactly one way back to the root: the
breadcrumb's `root` crumb — four characters, in a header the drag has to travel to. The tree's own listing
area, which is where a user aims when they mean "out to the root", is not a drop target at all: the drop
lands on nothing, no dialog opens, and the file silently stays where it is. Make that area a drop target
for the root.

**Blocked by:** 44

**Status:** resolved

- [x] With a file row in the air, the tree's listing area accepts a drop and means **the root**: the
      prototype's `Move "x" into "root"?` confirmation opens, exactly as a drop on the crumb does.
- [x] The folder rows keep their own meaning — they stop the event, so what reaches the listing area is
      precisely the drag that missed every folder. A drop between rows is a drop on the root.
- [x] The area lights up while the drag is over it, like a folder row does; the root crumb lights up with
      it, because it is the same destination.
- [x] **Tree only.** The flat list shows one folder rather than the root, so "the space between the rows"
      would have to mean that folder — a different question, and no part of this ticket.
- [x] The area is a labelled `group` (`Files tree`): the one handle both the rendered and the browser tests
      use to aim a drop at it, and a real boundary for a screen reader.
- [x] Tests: a rendered test that a drop on the area opens the `into "root"` confirmation (red before this
      ticket — no dialog appeared at all), and a leg in the browser spec that takes a file away from the
      root and brings it home this way, next to the existing crumb leg.

**Landed as:** the tree column's listing area grows `dropTarget(moveControl, '')` in tree view, alongside
the `outline-accent` highlight the folder rows use. Nothing else moved: ticket 44's `MoveControl`, the
confirmation, the refusal and the toast are unchanged.

**Why a bug and not a preference:** the drop was silent. With the crumb being the only target, the panel
had no way to say "you missed" — a user who dropped on the tree saw nothing happen and concluded the move
was impossible, which is exactly how it was reported.

## Reference

Reported against the deployed app: "when you put a file into a folder, you can no longer return it to the
root" — the gesture confirmed as *drop on the empty tree*, not the crumb. Ticket 44 carried this risk in
its own checklist ("the root crumb is the only drop target a file dragged out of a subfolder has");
`FilePanel.tsx:727` is the crumb, `:905` the folder rows.
