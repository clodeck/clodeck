# 37: A file operation that works says so (success toasts)

**What to build:** Create, rename, delete and upload all succeed silently today — the listing just
re-lists, and only failures speak. "I clicked and nothing happened" is the cheapest bug to prevent and
the cheapest to cause. Add one toast surface and emit a success message from each file mutation; make
it the seam the later tickets (39's upload summary, 42's download, 44's move) report through, instead
of each growing its own.

**Blocked by:** 33 (the `ok` token), 36 (the panel the operations live in)

**Status:** ready-for-agent

- [ ] A single toast surface for the web app: one message at a time, transient (about 2.2s), stacked
      above the drawer so it is not clipped by it, and exposed as a live region so a screen reader
      announces it.
- [ ] These mutations each emit exactly one toast on success: new file (`file x created in y`), new
      folder, rename (`renamed to x`), delete (`deleted x`), and a single-file upload. The messages
      match the operation's own vocabulary, not a generic "success".
- [ ] It is a reusable seam (a hook/component), not four copies of a `useState` string — tickets 39, 42
      and 44 add senders, not a second surface.
- [ ] Failure behaviour is unchanged: a failed mutation still surfaces where it does today (the viewer's
      error arm, the name prompt's inline error, the confirm dialog's error) and a success toast never
      replaces an error surface.
- [ ] The toast uses the `ok` token from 33 for its success accent, so the badge and the toast read as
      one system.
- [ ] Tests: a successful create and a successful delete each emit one toast with the expected text; a
      failed mutation emits none.

## Reference

Prototype toast (its text vocabulary is the source for the messages):
`prototype/common.js:666-672`, calls at `:526`, `:540`, `:607`, `:622`, `:640`. Current silence:
`web/src/files/FilePanel.tsx` (success path) and its error notice at `:113-125`. Parity item: D4.
