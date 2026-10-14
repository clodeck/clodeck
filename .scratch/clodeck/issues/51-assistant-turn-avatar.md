# 51: An assistant message is marked by its tile

**What to build:** In the transcript an assistant message is bare text and a user message is a bubble, so
the two roles are told apart only by that asymmetry, and a long exchange has no vertical landmark at all.
The prototype put a 26px gradient tile, carrying the mark, at the head of every assistant message. Bring
that back.

**Blocked by:** 50 (the tile is the gutter of the column that ticket defines)

**Status:** ready-for-agent

- [ ] Every assistant message in the transcript wears the tile at its head — 26px, rounded, the accent
      gradient, the mark inside — in the live transcript and in a stored one, which render through the
      same view (`EntryView`), so there is one place to change and one look to check.
- [ ] A user turn is unchanged (`You` above the right-aligned bubble). The transcript keeps the
      prototype's asymmetry; both roles do not get a tile.
- [ ] **A tool card, a thinking block and a notice carry no tile.** They belong to the message above them.
      Our transcript lists *entries*, not turns — a turn is not a node we render — so the tile marks the
      assistant's own text, which is the closest thing this view model has to the prototype's turn. Say so
      in the code, because "why is this not on the tool card" is the first question the next reader asks.
- [ ] **The streaming text wears the same head.** Today the live bubble is a separate element from the
      settled entry, so a tile added only to the entry would appear for the first time the moment a turn
      finishes. The head must be stable across that switch.
- [ ] The tile is decorative: `aria-hidden`, no text inside it, and it changes nothing about what a screen
      reader reads — the user turn's `You` label and every entry's own wording stay as they are.
- [ ] The tile is drawn from palette tokens (no hex literal outside `index.css`) and has a fixed size, so
      a long message does not stretch it.
- [ ] Tests: a rendered test asserts the tile on an assistant entry, none on a user entry, and none on a
      tool card.

## Reference

Prototype: `prototype/common.js:207-209` (`turnEl` puts the avatar on `turn-assistant` only) and
`prototype/styles.css:113-118` (`.avatar` — 26px, radius 7px, the accent gradient, centred); the mark is
`ICONS.logo` at `common.js:34`. Product: `web/src/chat/EntryView.tsx:24-25` (the assistant arm) and
`web/src/chat/ChatPanel.tsx:170-177` (`StreamingBubble`). Parity item: P2 #8.
