# 53: The open file's write state is one chip

**What to build:** The code head's right-hand side names the file's write state in one vocabulary and
offers it in another: a bare `read-only` / `writable` micro-label sits beside an `Edit` button, and a
truncated file replaces the state word with `truncated` and drops the control entirely — so the slot means
"state" until it means "a caveat". The prototype had one chip that carried the mode with a mark (a lock ⇄
a pencil) and was itself the switch. Give the head that one control.

**Blocked by:** 49 (the chip is a surface, and the level scale is where its tone comes from)

**Status:** resolved

- [x] The open file's write state is one chip in the code head: it names the state the file is **in**
      (`read-only` ⇄ `writable`), carries the prototype's mark, and is the control that switches it — one
      element stating the state and offering the action, with the state carried for assistive tech
      (`aria-pressed` or equivalent) rather than only drawn.
- [x] **Truncation stops borrowing that slot.** A truncated file says its write state *and* says
      `truncated`: two facts, two elements, one of which is not interactive. Today `truncated` takes the
      state's place and the whole slot changes meaning.
- [x] The rule that a truncated file cannot be edited stands (only the 256 KiB prefix is here, so a save
      would clobber the rest): it reads `read-only` with no switch, and the reason is available on the
      chip rather than implied by a word that does not say it.
- [x] One word per state, everywhere the state is named — the chip, its tooltip, any title. Today's mix
      (`read-only`, `Edit`, `writable`) is what this ticket removes; `Edit` was an action wearing a
      state's clothes.
- [x] Editing mode keeps what is already right: `writable` beside `Cancel` and `Save`, `Saving…` while it
      saves, and the existing disabled rules.
- [x] Unchanged: a binary file, a file with no preview, the error arm and its `Close`, and the markdown
      `Preview ⇄ Source` toggle (which is a different question — what the bytes are *read as*, not whether
      they can be written).
- [x] Tests: a rendered test asserts `read-only` on a text file, `writable` while editing, and a truncated
      file showing both `truncated` and `read-only` with no switch — the last of these is the one that is
      new behaviour, not a rename.

**Landed as:** one `WriteStateChip` (`web/src/files/FilePanel.tsx:1368`) replaces the bare state word and
the `Edit` button: it names the state, carries the prototype's lock ⇄ pencil, and *is* the switch by taking
an `onClick` — a `<button>` when the state can be switched, the same word in an inert `<span>` when it
cannot (a truncated file, and a file already being edited, where `Cancel`/`Save` are the write). Truncation
keeps its own `Note`, so the slot no longer changes meaning.

## Code review

Two axes of review over the branch. One fix:

1. **The chip announced the opposite of its own word.** `aria-pressed={writable}` was emitted only by the
   switchable chip, which is always the `read-only` one — so every rendered instance said
   `aria-pressed="false"`, and a control *called* `read-only` reported itself unpressed, which reads as
   writable. The chip's word is the state, so the switchable chip is always pressed; the test asserted the
   old constant and now asserts the state it names.

Declined on purpose:

- **Hoisting the two `state="read-only"` pass-throughs in `CodeActions`.** Both arms of the truncation
  ternary hand the chip the same state and differ only in `title` and `onClick`; the ternary is there to
  pick props, which is what it reads as. Merging them hides which of the two is the switch.
- **The editing arm's chip is inert.** Item 1's "is the control that switches it" is unqualified, and the
  prototype's chip toggles both ways; here the write-back is `Cancel`, which item 5 pins. Left as the
  ticket's own item 5 has it.
- **`Note` keeping one caller.** The chip took over `Note`'s old tone and left a one-line wrapper. It is
  the drawer's one styled caveat and reads as a name for the thing, not as indirection.

## Reference

Prototype: `prototype/variant-a.js:98-103,136` (the mode chip with the lock / pencil marks in the viewer
head) and `prototype/common.js:698-700` (the same in the shared viewer), over the `.chip` surface in
`prototype/styles.css`. Product: `web/src/files/FilePanel.tsx:1198` (`CodeActions`), `:1368`
(`WriteStateChip`), `:1430` (`Note`). Parity item: P2 #26 — the parity list's note was that the product's
arrangement is better but its label text has no unity, which is the half this ticket takes.
