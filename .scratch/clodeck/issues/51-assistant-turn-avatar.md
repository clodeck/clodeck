# 51: An assistant message is marked by its tile

**What to build:** In the transcript an assistant message is bare text and a user message is a bubble, so
the two roles are told apart only by that asymmetry, and a long exchange has no vertical landmark at all.
The prototype put a 26px gradient tile, carrying the mark, at the head of every assistant message. Bring
that back.

**Blocked by:** 50 (the tile is the gutter of the column that ticket defines)

**Status:** resolved

- [x] Every assistant message in the transcript wears the tile at its head — 26px, rounded, the accent
      gradient, the mark inside — in the live transcript and in a stored one, which render through the
      same view (`EntryView`), so there is one place to change and one look to check.
- [x] A user turn is unchanged (`You` above the right-aligned bubble). The transcript keeps the
      prototype's asymmetry; both roles do not get a tile.
- [x] **A tool card, a thinking block and a notice carry no tile.** They belong to the message above them.
      Our transcript lists *entries*, not turns — a turn is not a node we render — so the tile marks the
      assistant's own text, which is the closest thing this view model has to the prototype's turn. Say so
      in the code, because "why is this not on the tool card" is the first question the next reader asks.
- [x] **The streaming text wears the same head.** Today the live bubble is a separate element from the
      settled entry, so a tile added only to the entry would appear for the first time the moment a turn
      finishes. The head must be stable across that switch.
- [x] The tile is decorative: `aria-hidden`, no text inside it, and it changes nothing about what a screen
      reader reads — the user turn's `You` label and every entry's own wording stay as they are.
- [x] The tile is drawn from palette tokens (no hex literal outside `index.css`) and has a fixed size, so
      a long message does not stretch it.
- [x] Tests: a rendered test asserts the tile on an assistant entry, none on a user entry, and none on a
      tool card.

**Landed as:** one `AssistantMessage` (`web/src/chat/EntryView.tsx:56`) — the tile and the text in one row,
so the head is defined once and drawn by both callers. `AssistantTile` (`:78`) is the prototype's
`.avatar`: `h-[26px] w-[26px] shrink-0`, `rounded-[7px]`, `bg-linear-[150deg] from-accent to-accent-deep`,
the mark (`ICONS.logo`, `common.js:34`) inside, `aria-hidden` and empty. The gradient's second stop needed a
token, so `--color-accent-deep: #8f4327` (`web/src/index.css:27`) joins the palette with the prototype's own
value (`styles.css:118`) — no hex leaves `index.css`.

Bullet 4 is the reason `StreamingBubble` **moved here** from `ChatPanel.tsx` (now `EntryView.tsx:98`, drawn
by `LiveTranscript` through the import): the streaming text and the settled entry are two different elements,
so "the same head" had to mean the same *component* rather than two that agree today. Bullet 3 is written on
`AssistantMessage` itself — the tile marks the assistant's own text and nothing else, because our transcript
lists entries and not turns, and a card is not a speaker. A user turn is untouched: `You` over the
right-aligned bubble, the prototype's asymmetry.

Tests (`EntryView.test.tsx`): the tile on an assistant entry, none on a user entry (whose `You` label is
asserted to still be there), none on the thinking block, the notice or the tool card, and the same tile on
`StreamingBubble` — which is what pins bullet 4 rather than leaving it to reading. `data-assistant-tile` is
the handle the test aims at, as `data-chat-column` is ticket 50's; whether the 26px tile reads as the
prototype's is the browser's to say, since jsdom computes no boxes.

## Code review

Two axes over the branch, both landing on the same two sentences. One fix:

1. **The gradient's angle.** Bullet 1 asks for *the accent gradient*, the prototype draws
   `linear-gradient(150deg, …)` (`styles.css:118`) — the very line `index.css` quotes beside the new token —
   and the first version rendered `bg-linear-to-br`, which is 135°. Fifteen degrees, in the one place the
   ticket asks to be faithful to. It is `bg-linear-[150deg]` now, and the built stylesheet was read back to
   check it: `linear-gradient(150deg, var(--color-accent), var(--color-accent-deep))`. The tile's docblock
   also stops restating its own markup and says why the angle is that one.

Declined on purpose:

- **`text-white` on the mark.** The palette owns no white, and this is the only raw Tailwind colour left in
  `web/src`; the repo's own on-accent token is `text-canvas`. Kept white because the prototype's mark is
  `color:#fff` on the same gradient, and `text-canvas` would invert it to dark-on-accent — a different
  design, not a stricter palette. Bullet 6's rule is about hex literals, and this is not one.
- **The class-string assertion** (`EntryView.test.tsx:145`, `h-[26px]` / `shrink-0` to prove a long message
  does not stretch the tile). jsdom computes no boxes, so it cannot fail for the behaviour it names; it is
  the same trade `FilePanel.test.tsx` makes, and the browser check above is where the box is really judged.
- **`className` on `AssistantMessage`** — passed by one caller today (`StreamingBubble`'s `mt-3`) with the
  other passing nothing, which the Shape rule would call an abstraction with one user. It is the caller's
  spacing and nothing else, and the head cannot be split from it without the two callers drifting.
- **A third module for the head.** The review's real point stands: this file now changes both when the
  transcript renders differently and when the live bubble does. Extracting `AssistantMessage` +
  `StreamingBubble` into their own module would answer it, and is worth doing when a third caller appears —
  not as a rename of two functions into a file of their own.

## Reference

Prototype: `prototype/common.js:207-209` (`turnEl` puts the avatar on `turn-assistant` only) and
`prototype/styles.css:113-118` (`.avatar` — 26px, radius 7px, the accent gradient at 150°, centred); the mark
is `ICONS.logo` at `common.js:34`. Product: `web/src/chat/EntryView.tsx:24-25` (the assistant arm), `:56`
(`AssistantMessage`), `:78` (`AssistantTile`) and `:98` (`StreamingBubble`, which moved here from
`ChatPanel.tsx`). Parity item: P2 #8.
