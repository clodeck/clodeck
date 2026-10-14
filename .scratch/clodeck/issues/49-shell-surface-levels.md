# 49: The shell gets the prototype's depth of surface

**What to build:** The whole app is two tones — `canvas` and `panel` — so a tool card, the composer box
and a user's bubble all sit on the same plane and are told apart only by hairlines and translucent
`white/5` washes. The prototype read as layers: five surfaces from the page up, each a step lighter than
the one it sits on. Add that scale and put the existing surfaces on it, so depth carries meaning again
instead of every panel being flat.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The palette carries the prototype's surface scale as tokens — the page plus the four steps above it
      (`--bg` … `--bg-4`) — beside the existing tokens in `web/src/index.css`, with a Tailwind utility
      emitted for each one. `npm run build` is the check: jsdom does not process the stylesheet, so a
      rendered test can only assert a class name.
- [ ] The surfaces that today share one plane are placed on the scale rather than left as washes and
      literals: at least a tool card (its head against its body), the composer box, a user's bubble, the
      drawer's own chrome, and the hover/active tone of a file row and of a rail button. Where the
      prototype has a level for a surface, the level is used.
- [ ] **The change is additive**: `canvas` stays the page and `panel` stays the surface the sidebar and
      drawer sit on, at their present values. A surface moves onto a new level only where this ticket
      says so — nothing else changes colour by accident.
- [ ] Contrast holds at every level a thing can appear on: body text stays `ink`, secondary text stays
      `ink-dim`, and the `ok` badge (33) and the five code-view tokens (45) still read on theirs.
- [ ] Any surface deliberately left where it is — the product is flatter than the prototype in places on
      purpose — is named in the landed note with its reason, so the next session does not read it as an
      omission.
- [ ] Checked in the browser: depth is exactly what jsdom cannot see, so the result is confirmed on the
      running app and the check named in the landed note.
- [ ] Tests: rendered tests that name a changed class are updated, never deleted. No behaviour changes
      here, so nothing but a class assertion should move.

## Reference

Prototype: `prototype/styles.css:4-24` (the five levels and the rest of the palette), used at `.panel`
(bg-1), `.panel-head` and `.tool-head` (bg-2), `.icon-btn:hover` (bg-3) / `.on` (bg-4),
`.turn-user .bubble` (bg-3), `.composer` (bg-1) / `.composer-box` (bg-2). Product:
`web/src/index.css:5-23`. Parity item: P2 #10 — the item the parity list called "flatter; maybe
without fixing", promoted deliberately.
