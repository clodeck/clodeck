# 50: The chat reads as a centred column

**What to build:** The transcript and the composer run the full width of the stage, so on a wide screen a
line of prose stretches across the window and the prompt box is a different width from the chat above it.
The prototype read as a column: one 780px band, centred, with the surface behind it running full-bleed.
Give the chat that band.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The live transcript, a stored transcript, and the composer sit in one centred band of the same
      width (780px in the prototype), so the prompt box lines up with the messages above it and the
      chat has one left edge from top to bottom.
- [x] The chat's own status lines are in the band too — the resume banner, the live indicators, the
      result line and the error banner belong to the same column, not to the window.
- [x] The surfaces behind the band stay full-bleed: the chat's background, its top border and the footer's
      rule do not shrink to the band's width.
- [x] Narrower than the band, the column is full width at today's padding — no horizontal scroll, no
      squeezed text.
- [x] The empty state and the history browser are inside the band as well: "Send a prompt to start the
      session." centres in the column, not in the window.
- [x] **Nothing inside a turn changes** — not a font size, not a colour, not the gap between entries. This
      ticket moves the band; ticket 51 is what changes a turn's own layout.
- [x] Tests: a rendered test asserts the transcript and the composer share the column element; the
      geometry itself is confirmed in a real browser, since jsdom computes no boxes.

**Landed as:** `web/src/chat/ChatColumn.tsx` — **new**. One band: `mx-auto w-full max-w-[780px] px-4`,
carrying `data-chat-column` so the rendered test and the browser check have a handle that is not a
utility class. It is one component rather than the same three utilities written out in the transcript,
the footer and the history browser, because "the prompt box lines up with the messages above it" *is* a
shared width, and a shared width copied three times is a shared width that drifts the first time one
copy is touched. It is the column and never a surface: callers keep their own padding-y, borders and
backgrounds and band only their contents.

Where it went: `ChatPanel.tsx`'s scroller (the live transcript and `TranscriptPanel` both, since they
already share one container), the same file's footer — whose `border-t` stays full-bleed and whose one
child is now the band holding the resume banner, the live indicators, the result line, the error banner
and `Composer` — and `SessionHistory.tsx`'s `SessionBrowser`, which keeps its own `border-b` and
`bg-panel/60` wash full-bleed and bands only the list it draws. Nothing else in the chat moved: the
scroller is still `min-h-0 flex-1 overflow-y-auto py-3` with its `px-4` now living on the band, and
`EmptyChat` is untouched from `main`.

Because the band is the same element everywhere, the two bands the chat shows at once carry the *same
class string* — which is what the rendered test asserts, rather than two widths that happen to agree.

**Left full-bleed on purpose:** the chat's own top bar — `CHAT`, the connection pill, the model, and the
`History` / `Interrupt` buttons. Bullet 1's "one left edge from top to bottom" is stated about the
band's members, and the ticket's own code references are the scroller (`:88`) and the footer
(`:103-128`) with the history browser named separately; this bar is, in the prototype, a full-bleed
`head` of its own (`variant-a.js:63-69`, `padding: 0 14px`) and its `border-b` is the "top border"
bullet 3 keeps full-bleed. Banding it would pull `History`/`Interrupt` in from the window's right edge,
which is a visible deviation from the prototype. If the next session disagrees, it is a three-line
change.

**What bullet 5 means here, exactly:** the empty state's *box* is the band rather than the scroller, so
it centres on the column's centre — measured, not assumed (below). Its **vertical** position is
unchanged and was never live: the chat section in `App.tsx` (`main` → `ChatPanel`) is content-height —
it has no `flex-1` — so neither the scroller nor the band ever has a height to distribute, which is why
the old `h-full` did nothing either. That is pre-existing and not this ticket's; no regression, and if a
later ticket makes the chat fill the stage, this band is already the thing the empty state would centre
in (it needs one class, not a re-think).

**Checked in the browser (the geometry, which jsdom cannot see):** a throwaway Playwright spec against
an isolated `dev:fake` pair (server 3301, Vite 5175 — 3001/5173 are the user's own loop) over a sandbox
projects root, at 1400×900 and again at 700×900. Re-run after the code review's fixes, so the numbers
are the shipped code's:

| What | Measured |
|---|---|
| Transcript band | `x=480`, `width=780` |
| Composer band | `x=480`, `width=780` — one left edge, one width |
| The chat stage, and the footer's rule | `x=340`, `width=1060` — full-bleed behind the band |
| The history browser, and its band | `x=340 w=1060` / `x=480 w=780` |
| At 700px wide | band `360` = the stage's `360`, and under the 780 ceiling — full width, today's gutter |
| The empty state | its centre and the band's centre are the same point (asserted) |

The throwaway spec, its config, the scripted dev entry and the sandbox were deleted afterwards; nothing
about the check is left in the tree.

**Tests:** `web/src/chat/ChatPanel.test.tsx` — **new**. It asserts that the transcript's band and the
composer's band are one column and not two that agree (the same class string, `max-w-[780px]`,
`mx-auto`, `px-4`), that the first holds the empty state and the second the prompt box, that the
history browser adds a third band inside its own full-bleed rule, and that the footer's rule is the
full-bleed element whose one child is the band. What a rendered test cannot say — where those boxes
land — is what the browser check above says.

**Code review:** both axes (Standards, Spec) ran over the diff. Fixed:

1. The band carried `min-h-full flex flex-col` and `EmptyChat` carried `flex-1`, for a centring that
   does not occur: a percentage `min-height` against a content-sized parent resolves as `auto`. Two
   independent probes (the reviewer's, and the browser check's own numbers) agree, so both are gone —
   `EmptyChat` is untouched from `main` and the band is a plain block. The bullet-5 wording above and
   the geometry table were corrected to say what is actually true.
2. A geometry row — "the band's height vs the scroller's `669` = `669`" — was a tautology: the scroller
   sizes itself to its content, so its content box *always* equals the band. Dropped.
3. `ChatColumn`'s optional `className` existed only for that `min-h-full`; with (1) it had no caller.
   Dropped, and the component's doc comment no longer describes a caller that does not exist.
4. `ChatPanel.tsx`'s imports were left out of alphabetical order.

Declined:

1. The chat's top bar is still not banded — named under "Left full-bleed" above, with the reason
   (the prototype's own `head` is full-bleed, and the ticket's band list does not include it).
2. `data-chat-column` is a layout hook rather than the labelled `group` ticket 48 used for its drop
   area. That area is something a user aims at and a screen reader is told about; a band is neither, and
   `role="group"` would be a claim about the document that is not true. The attribute's reason is in
   `ChatColumn`'s doc comment.

## Reference

Prototype: `prototype/styles.css:107-108` (`.transcript` / `.transcript-inner { max-width: 780px; margin:
0 auto }`) and `:153-173` (`.composer-inner`, the same width). Product: `web/src/chat/ChatPanel.tsx:88`
(the scroller) and `:103-128` (the footer holding the status lines and `Composer`). Parity item: P2 #7.
