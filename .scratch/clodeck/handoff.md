# Handoff — clodeck: the parity pass continues (tickets 41–43)

**Updated:** 2026-10-12
**Where the tree is:** HEAD is on **`main`**, with tickets **41** (the flat list beside the tree),
**42** (download as the bytes on disk) and **43** (markdown `Preview ⇄ Source`) merged. The ticket
branch is deleted and the next ticket has not been started. (Merged in `--no-ff`, so the five commits
under it — 41, 42, 43, the browser spec + evidence, and the review fixes — are readable as the change
they were.)

## What this phase is

Unchanged: the build is complete (tickets 01–30), the prototype↔UI gap list is settled and ticketed
(**issues 32–45**, from `prototype-parity.md` §"Tasmim-haye gerefte-shode"), and this phase works
through it. Nothing in that list is an MVP gap — the MVP is built; it is all parity drift and polish.
Ticket 31 (a real bug, fixed) lives in `issues/31-terminal-accumulates-on-switch.md`.

## Dev loop (unchanged, still load-bearing)

Port **3001 is unbindable on this machine** (Windows Hyper-V/WSL exclusion range). Run with `PORT=3300`:

```cmd
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:\work\clodeck-projects
set PORT=3300
npm run dev          rem -> http://localhost:5173   (npm run dev:fake if there is no API key)
```

## Guardrails (do not lose these)

- **The pre-commit hook** (`.githooks/pre-commit`, wired through `core.hooksPath` by `npm install`) runs
  `npm run typecheck` and `npm test`. There is no CI; the hook is why a red tree cannot be committed.
  `--no-verify` only if the user asks.
- **The browser loop is real, and it is now three specs.** `web/e2e/project-switch.spec.ts` (the
  accumulation bug), `web/e2e/file-upload.spec.ts` (38–40: a real `DataTransfer`, the overlay, a
  one-file drop and a two-file drop that loses one), and now `web/e2e/file-download.spec.ts`, which
  exists because **jsdom has no downloads**: clicking the `Download` anchor there is a
  `Not implemented: navigation to another Document` line, not a save. The new spec uploads a file
  named in Persian, follows the real link, and asserts the browser's own `suggestedFilename()` and the
  saved bytes — the only place the RFC 5987 disposition is proved. It writes into `demo` and deletes
  what it made through the row menu. All three need `PORT=3300 npm run dev` (or `dev:fake`) already up,
  and `UI_PASSWORD` in the environment.

## Where the frontier is

**Done:** 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43 — all merged.

**Ready now, blocked by nothing:** **44** (drag-move — `spec-04` already pins
`POST /files/move?path=&to=`; the server has no cross-directory move yet, and the row drag it needs is
exactly what 38's `hasOsFiles` gate keeps apart from an upload, so a row drag must keep carrying
`text/plain` and nothing else) and **45** (the code view's line-number gutter and syntax highlight —
source mode only, which is why 43's fenced blocks render as a plain `<pre>`).

## Behaviour that changed under this phase (read before touching these surfaces)

- **The tree column has two listings now, and the flat one is one folder.** The toolbar's
  `List ⇄ Tree` button swaps the tree for a flat list of **the active folder** — this product lists one
  directory per request and has no recursive route, so the whole-project flatten of the prototype was
  not ported. "The folder you are in" is the drawer's existing *active* folder, which a **collapse**
  also sets (ticket 36's rule, untouched): collapse `src`, hit `List`, and you are inside `src`.
- **The flat list navigates where the tree expands.** A folder row there calls the new `openDir`
  (select + load + leave expanded), not `toggle`, and the breadcrumb — a plain `in <folder>` line in
  tree mode — becomes a `root / … / here` trail of buttons, because the flat list has no other way up.
  Both listings render the same loaded `dirs`, which is what keeps the open file and the current folder
  across a flip; the choice is panel state, so it dies with the panel.
- **The code column's head is now an action area with three controls.** `Download` appears for **any**
  selected entry — it sits outside the per-kind switch, because whether there is a file to download does
  not depend on what its bytes turned out to be, so a file whose *read* failed is still downloadable.
  The markdown toggle appears only for markdown files (`.md`/`.markdown`), and a markdown file opens as
  **source**, as the prototype's does — the toggle is the only way to the rendering, and each open
  starts from source again.
- **`/files`, `/files/content` and `/files/download` now share one door** (`openProject` → `resolveAs`).
  Same statuses and same messages as before; the difference is that the guard exists once.

## Known loose ends

- **The download's toast is optimistic.** It fires on the click, because a page is told nothing about a
  download finishing: a file deleted on disk still toasts `downloaded x`, and the browser saves the 404
  body under that name. Tightening it costs a request per download for a message that is still a guess,
  so it is recorded on ticket 42 instead.
- **A file's `href` is passed through as written** (ticket 43). No scheme check — the prototype had
  none and the ticket asked for none. React neutralises `javascript:`, a `data:` link opens an opaque
  new tab, and a *relative* link opens a new tab onto the app's own origin rather than resolving inside
  the project.
- **`.markdown` is treated as markdown alongside `.md`.** The prototype's gate was `lang === 'md'`;
  the extra extension is deliberate and is the one place this ticket went past its reference.
- **spec-04's `FileViewerActions` block is from ticket 20 and is stale** (it still shows `open`/`up`).
  It now carries a note saying `web/src/files/useFiles.ts` is the source of truth, rather than being
  rewritten here.
- **Ticket 34's async detail is still untrue: nothing disables the textarea while connecting.** Only
  Send is disabled, so the box stays typeable until the socket is live. Unchanged by this phase; still
  needs a decision rather than a smuggled fix.
- **A file row near the bottom of the tree opens its `⋯` menu off the scroller's edge** (ticket 36 put
  the menu back on its row; the 42vh drawer leaves the last row or two no room below). Ticket 44 adds
  row dragging to those same rows. The fix is still to flip the menu upward for the lower half of the
  viewport, and ticket 37's toast — bottom-centre, over the drawer — now shares that corner with it.
- **The rail stays enabled with no project selected.** Clicking Files then records a tab the drawer
  cannot show; choosing a project afterwards opens it. Left as-is by 35 rather than inventing a disabled
  state.
- **The palette token has no test.** jsdom does not process the Tailwind stylesheet, so a test could
  only assert the class name; `npm run build` emitting `--color-ok:#4ea87a` / `.text-ok` is the check.
  It is now three surfaces on that token (33's badge, 37's toast, 39's summary).
- **Parked, deliberately:** make the rendered tests fail on `console.error`. If that lands, the download
  test needs a whitelist entry first — it clicks a real anchor, and jsdom answers with
  `Not implemented: navigation to another Document`.
- **`useFiles.upload` re-lists even when every file in the batch failed**, so a drop that lands nothing
  still costs one listing request. Kept because the batch has one settle path; a failure count that
  needs no re-list is not worth a second one.
- **A non-ASCII file name renders as raw bidi in its row** (an LTR container around RTL text, with no
  `dir` attribute): the Persian file in `demo` reads backwards in the tree. The name itself is intact —
  download and rename both use it correctly — but a `dir="auto"` on the name cell is a small fix nobody
  has ticketed.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent change,
and the standing decisions — the Variant A layout, the D3-promoted MVP scope, and file access scoped to
the project root.

**Evidence for this phase:** `npm run typecheck` clean; `npm test` → shared 9, server 235 passed +
7 skipped, web 137 (16 files); `npm run e2e` green, **all three specs**, against the installed Chrome;
`npm run build` green. Driven by hand/Playwright, against `dev:fake` and the `demo` project: the flat
list with its three columns and a folder row carrying nothing (`evidence/41-flat-list.png`), and a
markdown file previewed beside the `Source` toggle (`evidence/43-markdown-preview.png`). The review
found no missing requirement; what it raised and this left alone is on the tickets (42's optimistic
toast, 43's unchecked link schemes, 41's collapse-sets-active reading).
