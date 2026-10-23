# 97: A chat message reads in its own direction

**What to build:** A message written in Farsi with a Latin word inside it renders in the wrong visual order:
in the left-to-right shell, the sentence's two Farsi halves are laid out as though the sentence were
left-to-right, so read from the right the second half comes first, then the Latin word, then the first half —
`این پاسخ … npm run dev را اجرا کن …` becomes, right to left, `را اجرا کن … → npm run dev → این پاسخ …`. Only
the display lies: the bytes are intact, a live stream and a stored history entry both show the text as it was
sent, and the same sentence renders correctly once its paragraph is allowed to choose its own direction.

**Blocked by:** None

**Status:** resolved

- [x] A message's own text reads in its own direction in all four places the transcript draws it: a settled
      assistant entry, the assistant message still streaming, the user's own turn, and the thinking block above
      an answer.
- [x] The rule sits on the text element, not on the transcript, the head or the tile: `dir` is inherited, so a
      head beside the words would flip with them — the trap ticket 56 named for a file name.
- [x] A Latin message renders exactly as it does today, and a message that begins with a Latin word stays
      left-to-right while its Farsi runs still read in their own order.
- [x] The change is display-only: no session, no stored entry, no transcript and no request is touched.
- [x] Tests: a rendered test asserts every message's text element carries the direction rule and that no
      ancestor does — an assertion about the element, not about pixels, because jsdom lays nothing out. The
      browser's own ordering was measured once in a real Chrome and is quoted below; no browser spec was added.

**Landed as:** `dir="auto"` on the four text elements in `web/src/chat/EntryView.tsx` — the user bubble, the
assistant paragraph (`AssistantMessage`, which also draws the streaming text), and the thinking paragraph. It is
the browser's first-strong rule, the same one `Name.tsx` took in ticket 56, so it costs no helper of its own: a
message whose first strong character is Latin stays left-to-right, and one with no strong character at all is
left-to-right as today. Notices stay without it — their words are the app's own.

**Measured, not assumed:** the real `EntryView` output was rendered in headless Chrome with the reported
sentence, and the three pieces were located with `Range.getBoundingClientRect()`. With the attribute removed
(today's tree) the right-to-left order was `last → latin → first`; as rendered now it is
`first → latin → last`. That is the symptom and its absence, in pixels, rather than a theory about them.

**Tests:** `web/src/chat/EntryView.direction.test.tsx` — **new**. One case per surface above, each asserting
`dir="auto"` on the text element, plus one asserting the tile is outside it and no ancestor above the text
declares a direction. Element-level only, as ticket 56's were: jsdom lays nothing out, so the pixel claim is
the probe above, not a spec in the suite.
