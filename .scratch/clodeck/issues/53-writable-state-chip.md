# 53: The open file's write state is one chip

**What to build:** The code head's right-hand side names the file's write state in one vocabulary and
offers it in another: a bare `read-only` / `writable` micro-label sits beside an `Edit` button, and a
truncated file replaces the state word with `truncated` and drops the control entirely — so the slot means
"state" until it means "a caveat". The prototype had one chip that carried the mode with a mark (a lock ⇄
a pencil) and was itself the switch. Give the head that one control.

**Blocked by:** 49 (the chip is a surface, and the level scale is where its tone comes from)

**Status:** ready-for-agent

- [ ] The open file's write state is one chip in the code head: it names the state the file is **in**
      (`read-only` ⇄ `writable`), carries the prototype's mark, and is the control that switches it — one
      element stating the state and offering the action, with the state carried for assistive tech
      (`aria-pressed` or equivalent) rather than only drawn.
- [ ] **Truncation stops borrowing that slot.** A truncated file says its write state *and* says
      `truncated`: two facts, two elements, one of which is not interactive. Today `truncated` takes the
      state's place and the whole slot changes meaning.
- [ ] The rule that a truncated file cannot be edited stands (only the 256 KiB prefix is here, so a save
      would clobber the rest): it reads `read-only` with no switch, and the reason is available on the
      chip rather than implied by a word that does not say it.
- [ ] One word per state, everywhere the state is named — the chip, its tooltip, any title. Today's mix
      (`read-only`, `Edit`, `writable`) is what this ticket removes; `Edit` was an action wearing a
      state's clothes.
- [ ] Editing mode keeps what is already right: `writable` beside `Cancel` and `Save`, `Saving…` while it
      saves, and the existing disabled rules.
- [ ] Unchanged: a binary file, a file with no preview, the error arm and its `Close`, and the markdown
      `Preview ⇄ Source` toggle (which is a different question — what the bytes are *read as*, not whether
      they can be written).
- [ ] Tests: a rendered test asserts `read-only` on a text file, `writable` while editing, and a truncated
      file showing both `truncated` and `read-only` with no switch — the last of these is the one that is
      new behaviour, not a rename.

## Reference

Prototype: `prototype/variant-a.js:98-103,136` (the mode chip with the lock / pencil marks in the viewer
head) and `prototype/common.js:698-700` (the same in the shared viewer), over the `.chip` surface in
`prototype/styles.css`. Product: `web/src/files/FilePanel.tsx:1188-1254` (`CodeActions`), `:1331-1343`
(`EditToggle`), `:1345-1351` (`Note`). Parity item: P2 #26 — the parity list's note was that the product's
arrangement is better but its label text has no unity, which is the half this ticket takes.
