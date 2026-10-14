# 50: The chat reads as a centred column

**What to build:** The transcript and the composer run the full width of the stage, so on a wide screen a
line of prose stretches across the window and the prompt box is a different width from the chat above it.
The prototype read as a column: one 780px band, centred, with the surface behind it running full-bleed.
Give the chat that band.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The live transcript, a stored transcript, and the composer sit in one centred band of the same
      width (780px in the prototype), so the prompt box lines up with the messages above it and the
      chat has one left edge from top to bottom.
- [ ] The chat's own status lines are in the band too — the resume banner, the live indicators, the
      result line and the error banner belong to the same column, not to the window.
- [ ] The surfaces behind the band stay full-bleed: the chat's background, its top border and the footer's
      rule do not shrink to the band's width.
- [ ] Narrower than the band, the column is full width at today's padding — no horizontal scroll, no
      squeezed text.
- [ ] The empty state and the history browser are inside the band as well: "Send a prompt to start the
      session." centres in the column, not in the window.
- [ ] **Nothing inside a turn changes** — not a font size, not a colour, not the gap between entries. This
      ticket moves the band; ticket 51 is what changes a turn's own layout.
- [ ] Tests: a rendered test asserts the transcript and the composer share the column element; the
      geometry itself is confirmed in a real browser, since jsdom computes no boxes.

## Reference

Prototype: `prototype/styles.css:107-108` (`.transcript` / `.transcript-inner { max-width: 780px; margin:
0 auto }`) and `:153-173` (`.composer-inner`, the same width). Product: `web/src/chat/ChatPanel.tsx:88`
(the scroller) and `:103-128` (the footer holding the status lines and `Composer`). Parity item: P2 #7.
