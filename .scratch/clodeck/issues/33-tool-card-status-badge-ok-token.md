# 33: The tool card says what it is doing (status badge + the `ok` token)

**What to build:** Today a tool call is two collapsed `<details>` ("Input", "Result") and nothing else:
while a tool is running the card looks identical to a finished one, and the reader has to open a
disclosure to learn anything. Give the card a status — running / done / error — and open its body by
itself once it is done. Along the way add the palette's missing success token, which this badge and
ticket 37 (toasts) both need.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] The card header carries a status badge derived from the entry's own shape (no result yet →
      running; result with `isError` → error; result otherwise → done). No new field on the entry type
      is needed and none is added.
- [ ] Running reads as in-progress (the prototype's `running…` affordance), done uses the new success
      token, error keeps today's `err` treatment — which is already the only status the card shows.
- [ ] The **Result** body opens on its own when the result arrives, so a finished call is readable
      without a click, and the reader can still collapse it. While a call is running the body stays
      closed.
- [ ] `--color-ok` is added to the palette (`web/src/index.css`) as a sibling of `--color-err`, taken
      from the prototype's `styles.css` — a token, not a literal, because ticket 37's success toast
      uses it too.
- [ ] The transcript's one renderer stays one renderer: `SessionHistory`'s read-only transcript gets
      the same badge through `EntryView`, with no second card implementation.
- [ ] A rendered test pins the three states (running / done / error) and that a done result is open.

## Reference

Prototype tool card and badge: `prototype/common.js:176-200` (`.badge-ok`); palette:
`prototype/styles.css:17-18`. Current card: `web/src/chat/EntryView.tsx:41-80`.
