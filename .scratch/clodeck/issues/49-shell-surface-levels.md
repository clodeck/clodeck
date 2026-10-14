# 49: The shell gets the prototype's depth of surface

**What to build:** The whole app is two tones — `canvas` and `panel` — so a tool card, the composer box
and a user's bubble all sit on the same plane and are told apart only by hairlines and translucent
`white/5` washes. The prototype read as layers: five surfaces from the page up, each a step lighter than
the one it sits on. Add that scale and put the existing surfaces on it, so depth carries meaning again
instead of every panel being flat.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The palette carries the prototype's surface scale as tokens — the page plus the four steps above it
      (`--bg` … `--bg-4`) — beside the existing tokens in `web/src/index.css`, with a Tailwind utility
      emitted for each one. `npm run build` is the check: jsdom does not process the stylesheet, so a
      rendered test can only assert a class name.
- [x] The surfaces that today share one plane are placed on the scale rather than left as washes and
      literals: at least a tool card (its head against its body), the composer box, a user's bubble, the
      drawer's own chrome, and the hover/active tone of a file row and of a rail button. Where the
      prototype has a level for a surface, the level is used.
- [x] **The change is additive**: `canvas` stays the page and `panel` stays the surface the sidebar and
      drawer sit on, at their present values. A surface moves onto a new level only where this ticket
      says so — nothing else changes colour by accident.
- [x] Contrast holds at every level a thing can appear on: body text stays `ink`, secondary text stays
      `ink-dim`, and the `ok` badge (33) and the five code-view tokens (45) still read on theirs.
- [x] Any surface deliberately left where it is — the product is flatter than the prototype in places on
      purpose — is named in the landed note with its reason, so the next session does not read it as an
      omission.
- [x] Checked in the browser: depth is exactly what jsdom cannot see, so the result is confirmed on the
      running app and the check named in the landed note.
- [x] Tests: rendered tests that name a changed class are updated, never deleted. No behaviour changes
      here, so nothing but a class assertion should move.

**Landed as:** the tokens are `web/src/index.css`'s `@theme` gaining `--color-bg` … `--color-bg-4`, the
prototype's five levels verbatim (`prototype/styles.css:5-9`: `#0b0d10`, `#101318`, `#151a21`,
`#1b2129`, `#222a34`), beside the unchanged `canvas` and `panel`. `npm run build` emits `.bg-bg-1` …
`.bg-bg-4` as expected. `--color-bg` is the scale's first rung and is the same tone `canvas` already
was; nothing wears `bg-bg`, because this ticket keeps `canvas` as the page — Tailwind v4 emits utilities
on demand, so `.bg-bg` is deliberately absent from the built CSS rather than missing.

Six surfaces moved, each to the level the prototype gives it:

| Surface | Now | Prototype |
|---|---|---|
| Tool card body / head (`chat/EntryView.tsx`) | `bg-bg-1` / `bg-bg-2` | `.tool` / `.tool-head` (`styles.css:134-141`) |
| A user's bubble (`chat/EntryView.tsx`) | `bg-bg-3` (was `white/10`) | `.turn-user .bubble` (`styles.css:111-114`) |
| The composer box (`chat/Composer.tsx`) | `bg-bg-2` (was `panel`) | `.composer-box` (`styles.css:156-160`) |
| The drawer's chrome + its tabs (`App.tsx`) | strip `bg-bg-2`, tabs `bg-bg-3` hover / `bg-bg-4` selected | `.panel-head` (`:61-66`), `.icon-btn:hover`/`.on` (`:58-59`) |
| A rail button (`App.tsx`) | `bg-bg-3` hover / `bg-bg-4` pressed | `.icon-btn:hover`/`.on` |
| A file row (`files/FilePanel.tsx`) | `bg-bg-2` hover **and** drop-target, `bg-bg-3` active | `.tree-row:hover` / `.drop-target` / `.on` (`:199-200`, `:298`) |

The file row's three tones are now one expression (`EntryRow`'s `tone`) instead of three stacked
classes: `hover:bg-bg-2` outranks `bg-bg-3` on specificity, so a stacked version would have made the
*active* row look less current the moment the pointer reached it. The prototype's own CSS ordering
(`:hover` at `styles.css:199`, `.on` at `:200`) keeps the active tone under the cursor, and the single
expression is how that is reproduced in Tailwind.

**Left flat on purpose** (so the next session reads it as a decision, not an omission):

- The **rail's and the sidebar's own surfaces** stay `panel`, and the file panel's toolbar and code head
  take no background at all. The prototype paints the rail `--bg` and the toolbar `bg-1`, but this
  ticket names the rail *button* and the drawer's *chrome*, and bullet 3 keeps `panel` as the surface
  the sidebar and drawer sit on. Repainting the rail would put it under the sidebar, which is a
  different change.
- The **chat's top bar** and the **composer strip** keep the page's tone — no background at all. The
  prototype gives both `bg-1` (`.composer`, `styles.css:154`; the chat `head`, `variant-a.js:63`), so
  these are the two levels this ticket leaves unspent by name, not by oversight: it names the composer
  *box* and says nothing about the top bar, and painting a band above and below the transcript turns the
  chat into a two-tone frame with the drawer's own chrome starting immediately beneath it. That is a
  judgement about the chat's chrome, and ticket 50 — landing alongside — is explicit that the surfaces
  behind the band stay full-bleed; whoever does the chat's chrome next should make it deliberately.
- The **small ghost controls** — `Log out`, `Refresh`, the drawer's `✕`, the toolbar buttons, the row
  menus, the `⋯` — keep their translucent washes (`white/5`, and `white/10` on the `⋯` and on the
  active rail/tab tone this ticket replaced). A `white/5` over `panel` lands within a hair of `bg-3`, so
  the prototype's own hover tone is already what they wear; converting them would be churn with no
  visible gain.
- The **thinking disclosure** and the **history browser** keep `bg-panel/60`. Neither has a level in
  the prototype, and a translucent wash is what an *aside* wants; both are still legible against
  `canvas` and both were out of this ticket's list.
- The **terminal**, the **login screen**, the **approval dialog**, the **modals** and the **toast** are
  untouched — no level in the prototype maps to them, and the toast's `ok` tone (33) reads on `panel`.

**Contrast:** no text token changed, and every level is lighter than the page, so nothing lost contrast.
Checked the two the ticket names: the `ok` badge (`#4ea87a`) on its card head (`#151a21`) is about
6.0:1, and `ink-dim` (`#8b98a8`) on the same head about 5.9:1 — both above 4.5:1, slightly lower than
they were on `panel` and still clear. The five code-view tokens (45) live in the code column, which
this ticket does not move.

**Checked in the browser:** a throwaway Playwright spec on an isolated `dev:fake` pair (server 3301,
Vite 5175 — 3001/5173 are the user's own loop) over a sandbox projects root, with a scripted turn whose
transcript includes a tool call, so a **live tool card and a user bubble were on screen**. Read back as
computed `background-color` at 1400×900:

| Surface | In the app | Is |
|---|---|---|
| Page (`canvas`) | `rgb(11, 13, 16)` | `#0b0d10`, unchanged |
| Sidebar (`panel`) | `rgb(18, 22, 28)` | `#12161c`, unchanged |
| Tool card body | `rgb(16, 19, 24)` | `bg-1` |
| Tool card head | `rgb(21, 26, 33)` | `bg-2` — a step above the body |
| User bubble | `rgb(27, 33, 41)` | `bg-3` |
| Composer box | `rgb(21, 26, 33)` | `bg-2` |
| Drawer strip / selected tab | `rgb(21, 26, 33)` / `rgb(34, 42, 52)` | `bg-2` / `bg-4` |
| Rail pressed / hovered | `rgb(34, 42, 52)` / `rgb(27, 33, 41)` | `bg-4` / `bg-3` |
| File row hovered / active folder | `rgb(21, 26, 33)` / `rgb(27, 33, 41)` | `bg-2` / `bg-3` |

The scale itself was read off the running stylesheet the same way (`bg-bg` → `rgb(11,13,16)`, `bg-bg-1`
→ `rgb(16,19,24)`, … `bg-bg-4` → `rgb(34,42,52)`), and the screenshot confirmed depth reads as depth:
the card's head sits visibly above its body, the drawer's tab strip above the drawer, the composer box
above the page. The throwaway spec, its config, the scripted dev entry and the sandbox were deleted;
nothing about the check is left in the tree.

**Tests:** `web/src/chat/EntryView.test.tsx` gains two class assertions — the card's body/head levels
and the user bubble's — as the one rendered surface that names them. No existing test named a changed
class (the file panel's assertions are about `outline-accent`, widths and the code tokens), so nothing
was updated and nothing was deleted. Web suite: 166 passed, 19 files.

**Code review:** both axes (Standards, Spec) ran over the diff. Fixed:

1. Once the rail's buttons and the drawer's tabs had both moved, they repeated the same two tones.
   `App.tsx` now holds them once, as `CHROME_TONE` (`current` / `resting`), with the text colour each
   caller's own — they are the same control in the prototype (`.icon-btn`, `styles.css:58-59`), so they
   have to move together.
2. The two levels this ticket leaves unspent — the chat's top bar and the composer strip, both `bg-1`
   in the prototype — were not in the note's flat list. They are now, with the reason.
3. The note's file-row table called the drop target `bg-3`; the code has `bg-2`. The table now matches
   the code (and the prototype's `.tree-row.drop-target`).
4. "The ghost controls keep their `white/5` washes" was not quite true of the `⋯`, which is
   `white/10`. Corrected.

Declined:

1. `--color-bg` is a token nothing wears, whose value duplicates `canvas`. Bullet 1 asks for the page
   plus the four steps, and the prototype's scale *is* five levels; dropping it would leave the scale
   as four steps above an unnamed page. `index.css` says so where it is declared.
2. `bg-bg-1` … `bg-bg-4` carry no domain meaning, unlike `canvas`/`panel`/`ink`. They are the
   prototype's own names, kept verbatim so the mapping stays checkable line-for-line against
   `styles.css:5-9`; semantic names would break that and buy nothing.
3. `EntryRow`'s `tone` mixes a hover variant with bare tones. That mix is the mechanism, not an
   accident: `hover:bg-bg-2` outranks a bare `bg-bg-3`, so the arms cannot be uniform without the
   active row losing its tone under the cursor. The comment says so.

The branch carries both tickets (`clodeck/49-50-…`) rather than one branch each, against the `<effort>/<ticket>-<slug>` shape in `AGENTS.md`: the two were asked for together, and each lands as its own commit, so either can be reverted on its own.

## Reference

Prototype: `prototype/styles.css:4-24` (the five levels and the rest of the palette), used at `.panel`
(bg-1), `.panel-head` and `.tool-head` (bg-2), `.icon-btn:hover` (bg-3) / `.on` (bg-4),
`.turn-user .bubble` (bg-3), `.composer` (bg-1) / `.composer-box` (bg-2). Product:
`web/src/index.css:5-23`. Parity item: P2 #10 — the item the parity list called "flatter; maybe
without fixing", promoted deliberately.
