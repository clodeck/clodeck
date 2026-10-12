# 33: The tool card says what it is doing (status badge + the `ok` token)

**What to build:** Today a tool call is two collapsed `<details>` ("Input", "Result") and nothing else:
while a tool is running the card looks identical to a finished one, and the reader has to open a
disclosure to learn anything. Give the card a status — running / done / error — and open its body by
itself once it is done. Along the way add the palette's missing success token, which this badge and
ticket 37 (toasts) both need.

**Blocked by:** none

**Status:** resolved

- [x] The card header carries a status badge derived from the entry's own shape (no result yet →
      running; result with `isError` → error; result otherwise → done). No new field on the entry type
      is needed and none is added.
- [x] Running reads as in-progress (the prototype's `running…` affordance), done uses the new success
      token, error keeps today's `err` treatment — which is already the only status the card shows.
- [x] The **Result** body opens on its own when the result arrives, so a finished call is readable
      without a click, and the reader can still collapse it. While a call is running the body stays
      closed.
- [x] `--color-ok` is added to the palette (`web/src/index.css`) as a sibling of `--color-err`, taken
      from the prototype's `styles.css` — a token, not a literal, because ticket 37's success toast
      uses it too.
- [x] The transcript's one renderer stays one renderer: `SessionHistory`'s read-only transcript gets
      the same badge through `EntryView`, with no second card implementation.
- [x] A rendered test pins the three states (running / done / error) and that a done result is open.

## Reference

Prototype tool card and badge: `prototype/common.js:176-200` (`.badge-ok`); palette:
`prototype/styles.css:17-18`. Current card: `web/src/chat/EntryView.tsx:41-80`.

## What landed

```
web/src/index.css               --color-ok: #4ea87a (the prototype's --ok), sibling of --color-err.
web/src/chat/EntryView.tsx      toolStatus(entry) -> 'running' | 'done' | 'error', the only place the
                                entry's shape is read as a status; ToolStatusBadge in the card header
                                (running… as the prototype's chip, done in text-ok, error in text-err);
                                ToolResultDisclosure, which auto-opens on arrival via a ref keyed by
                                toolUseId so a streaming re-render never re-opens it under the reader.
                                DISCLOSURE / DISCLOSURE_SUMMARY shared by both bodies.
web/src/chat/EntryView.test.tsx new: five rendered tests — the three states, a done result open, the
                                running -> arrived transition opening the body, and the reader's
                                collapse surviving a re-render.
```

`reducer.ts` is untouched: the status is derived, never stored. `SessionHistory` renders through the
same `EntryView`, so the transcript's card is this card.

## Code review

Both axes on the branch (`b6771ac`). Standards: no documented-standard breach — branch/commit form,
token-not-literal (`#4ea87a` matches the prototype exactly), colocated jsdom test, and the exhaustive
`switch` idiom all match the repo. Spec: all six checklist items present; the reviewer mutation-checked
the test file (neutering the auto-open fails two tests, moving the `done` badge off `text-ok` fails one)
and confirmed no test can pass while the behaviour is broken.

Fixed in one pass (the review-fix commit on this branch):

1. **Unused public surface.** `ToolStatus` and `toolStatus` were exported with no consumer outside the
   file; the `export` is gone, so the module's surface is unchanged from before this ticket.
2. **`isError` read as presentation in two places.** `toolStatus` was alone in reading the entry; the
   `Result` summary re-derived the same condition. The disclosure now takes the status and derives
   `failed` once.
3. **Duplicated disclosure chrome.** The Input and Result bodies both spelled out
   `border-t border-line px-3 py-2` / the summary classes; they are now `DISCLOSURE` /
   `DISCLOSURE_SUMMARY`, one place each.
4. **`running…` was bare text.** The prototype's running affordance is its `.chip` pill and this ticket
   asks for exactly that reading; `running…` now wears the pill (`rounded-full bg-white/5`) while `done`
   and `error` stay bare words in their tokens.

Declined on purpose:

- **Passing the whole `entry` into the Result disclosure instead of `toolUseId` + `status` + `result`.**
  The narrow props keep `result` non-null by construction; `entry` would force a null check that can
  never fire.
- **A test for the palette token itself.** jsdom does not process the Tailwind stylesheet, so a test
  could only assert the class name (which the badge tests already do). The token's presence in the
  built CSS was verified by hand instead: `npm run build` emits `--color-ok:#4ea87a` and `.text-ok`.
