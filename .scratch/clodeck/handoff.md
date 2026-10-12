# Handoff — clodeck: the parity list is empty (tickets 44 and 45)

**Updated:** 2026-10-12
**Where the tree is:** HEAD is on **`main`**, with tickets **44** and **45** merged (`b924ec9`,
`--no-ff`, so the six commits under it are readable as the change they were) and the ticket branch
deleted. Nothing is pushed, and nothing is left on a branch: this was the last item on the list.

## What this phase is

The end of the list. The build was complete at tickets 01–30, and tickets **32–45** worked through the
prototype↔UI gap list (`prototype-parity.md` §"Tasmim-haye gerefte-shode"). **44 was the last item of the
five decision D3 promoted** into MVP, and **45 was the only `P2` item that decision selected** — so this
phase closes both the D3 set and the selected P2 item. Nothing on that list is left; ticket 31 (a real
bug, fixed) lives in `issues/31-terminal-accumulates-on-switch.md`, and the `P1`/`P2`/`P3` items nobody
selected stay out of scope by decision.

## Dev loop (unchanged, still load-bearing)

Port **3001 is unbindable on this machine** (Windows Hyper-V/WSL exclusion range). Run with `PORT=3300`,
and **give `PROJECTS_ROOT` forward slashes**: Git Bash eats the backslashes in an env assignment, and the
server then scans `<repo>\workclodeck-projects` and discovers nothing — an empty project list, with the
reason only in its warn line.

```cmd
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:/work/clodeck-projects   rem  backslashes are mangled under Git Bash
set PORT=3300
npm run dev          rem -> http://localhost:5173   (npm run dev:fake if there is no API key)
```

## Guardrails (do not lose these)

- **The pre-commit hook** (`.githooks/pre-commit`, wired through `core.hooksPath` by `npm install`) runs
  `npm run typecheck` and `npm test`. There is no CI; the hook is why a red tree cannot be committed.
  `--no-verify` only if the user asks.
- **The browser loop is real, and it is now five specs.** `web/e2e/project-switch.spec.ts` (the
  accumulation bug), `file-upload.spec.ts` (a real `DataTransfer`, the overlay, a one-file and a
  two-file drop), `file-download.spec.ts` (jsdom has no downloads, so only a browser can say which name
  the disposition buys), and now `file-move.spec.ts` and `code-view.spec.ts` — the drag itself (jsdom has
  no `DragEvent`) and the code column's geometry and colours (jsdom computes neither boxes nor styles).
  All five need `PORT=3300 npm run dev` (or `dev:fake`) already up, `UI_PASSWORD`, and they drive the
  `demo` project, cleaning up what they make. `npm run e2e` from the root. They share their opening —
  the environment check, the login, the row cleanup — through `web/e2e/support.ts`, which is typechecked
  too (the pre-commit hook covers `e2e/`). **A spec that fails mid-test leaves its files in `demo`**, and
  the next run then fails on a `409` that has nothing to do with the code: clear `zz-*` out of
  `D:/work/clodeck-projects/demo` before believing a red run.

## Where the frontier is

**Done:** 32–45 — **all merged**, 44 and 45 included. Nothing is blocked and nothing is
ready-but-unstarted: the parity list is empty.

**If you are asked for more:** the honest next steps are a bug hunt or a fresh gap list against the
prototype, not more of this list. `prototype-parity.md` §"P2"/"P3" is where the consciously-skipped items
live if a decision to revisit them is ever taken.

## Behaviour that changed under this phase (read before touching these surfaces)

- **A file row in the tree is draggable and a folder row is a drop target**, and so is the
  **breadcrumb's root crumb**. The drag carries `text/plain` and nothing else — a drag advertising
  `Files` would be read as an OS-file upload by the panel's own drop handler (38), and the two must
  never collide. Dropping opens `Move "x" into "y"?` first; only confirming sends anything.
- **The tree column's header is the breadcrumb now, in both listings.** Ticket 41 gave the trail to the
  flat list and left the tree a plain `in <folder>` line; the root crumb is the only way home for a file
  dragged out of a subfolder, so both listings show the same `root / … / here` trail, and the tree's
  crumb buttons go through the same `openDir` the flat list's do. The `title` that said where create and
  upload land moved onto the nav.
- **The server has a cross-directory move.** `ScopedFs.move(source, destDir)` returns its own
  `MoveResult` (the four `WriteResult` arms it shares plus `same_directory`, `into_own_descendant`,
  `not_a_directory`), and `POST /files/move?path=` takes the destination **directory** in the body as a
  *path* — so it passes `relPath`'s syntax check, not `name()`. `relPath` is now thin over a new
  `isRelative`. `409` for a collision or a same-directory move, `400` for a destination that is not a
  directory or a folder into its own subtree, `404` for either end missing (an escaping symlink included,
  because the destination goes through the reader's door). **A link as the source is refused; a link as
  the destination is followed** if it stays inside the root — the reader follows in-root links by design,
  and every other write accepts one as its parent too, so refusing it here would make `move` the one
  operation that rejects what `create` takes. `spec-04` and ticket 44 say this now.
- **The code column's source mode is a numbered, coloured code view** (`web/src/files/code.tsx`): one
  `<ol>` row per line, the number in a fixed-width `select-none`/`aria-hidden` gutter, the line beside it
  in `whitespace-pre` so it scrolls instead of wrapping. The five colours are palette tokens added to
  `index.css`. Preview is still `renderMarkdown`, with no gutter — the gutter and the colouring are
  source mode's only. `highlightLine(line, language) → Segment[]` is pure and the segments are React text
  nodes: nothing here sets `innerHTML`, which is what `spec-04` pins.

## Known loose ends

- **The move has no keyboard path.** A file is relocated by dragging its row; there is no command for it
  in the row's `⋯` menu, where rename and delete live. The prototype had none either, and the ticket
  asked for the drag — but it is the one row action you cannot reach without a mouse.
- **The client refuses a same-directory drop after the confirmation, not before it.** Ticket 44 said
  "dropping opens the prototype's confirmation", so it is taken literally: the dialog appears, and
  confirming it says `already in <folder>` rather than performing a no-op. A drop that opens a dialog
  whose only outcome is that sentence is a small wart, and moving the check to the drop would be a
  one-line change.
- **The highlighter is line-based**, as the prototype's was: a `/* … */` block or a multi-line template
  literal is coloured line by line, not as one run. Deliberate ("a deliberately rough pass, not a
  parser"), and the fix if it ever matters is a second pass over the joined line.
- **`.markdown` is treated as markdown alongside `.md`**, and an extension the map does not list renders
  plain (the prototype fell back to TypeScript). Both are deliberate departures, recorded on ticket 45.
- **`fireEvent.dragLeave` cannot carry `relatedTarget`** in this stack (React's synthetic event arrives
  without it), and jsdom has no `DragEvent` at all. The panel test's `dragLeaves` helper therefore
  dispatches a bubbling `MouseEvent` inside `act` — the only way to test "moving between a row and its
  own children is not leaving the row". The same limit is why the upload spec's leave test uses
  `relatedTarget: null`.
- **A file row near the bottom of the tree opens its `⋯` menu off the scroller's edge** (ticket 36 put
  the menu back on its row; the 42vh drawer leaves the last row or two no room below). Still not fixed:
  the fix is to flip the menu upward for the lower half of the viewport, and ticket 37's toast —
  bottom-centre, over the drawer — now shares that corner with it. Ticket 44 added dragging to those same
  rows and changed nothing about the menu.
- **The code-view spec restates the palette's three hexes as `rgb(…)`.** That is the point of it — the
  check is that the token reaches the paint at all — but it does mean re-colouring the code view is a
  two-file change, and it will be asked about once.
- **`split(line, pattern, kinds, base)` keeps its four arguments.** One review called `pattern` and
  `kinds` a data clump, since they only ever travel together; left as-is because bundling them buys a
  type for two call sites and a parameter that already reads fine. Everything else the two reviews raised
  is fixed in the last commit.
- **The download's toast is optimistic.** It fires on the click, because a page is told nothing about a
  download finishing: a file deleted on disk still toasts `downloaded x`, and the browser saves the 404
  body under that name. Recorded on ticket 42.
- **A file's `href` is passed through as written** (ticket 43). No scheme check — the prototype had none
  and the ticket asked for none.
- **spec-04's `FileViewerActions` block is from ticket 20 and is stale** (it still shows `open`/`up`).
  It now carries a note saying `web/src/files/useFiles.ts` is the source of truth, rather than being
  rewritten here.
- **Ticket 34's async detail is still untrue: nothing disables the textarea while connecting.** Only
  Send is disabled, so the box stays typeable until the socket is live. Unchanged by this phase; still
  needs a decision rather than a smuggled fix.
- **The rail stays enabled with no project selected.** Clicking Files then records a tab the drawer
  cannot show; choosing a project afterwards opens it. Left as-is by 35 rather than inventing a disabled
  state.
- **The palette token has no unit test.** jsdom does not process the Tailwind stylesheet, so a rendered
  test could only assert the class name; `npm run build` emitting the token and its utility is the
  check — and `code-view.spec.ts` now asserts the *resolved* colours of the five code tokens in a real
  browser, which is the strongest form that check has taken.
- **Parked, deliberately:** make the rendered tests fail on `console.error`. If that lands, the download
  test needs a whitelist entry first — it clicks a real anchor, and jsdom answers with
  `Not implemented: navigation to another Document`.
- **`useFiles.upload` re-lists even when every file in the batch failed**, so a drop that lands nothing
  still costs one listing request. Kept because the batch has one settle path.
- **A non-ASCII file name renders as raw bidi in its row** (an LTR container around RTL text, with no
  `dir` attribute): the Persian file in `demo` reads backwards in the tree. The name itself is intact —
  download and rename both use it correctly — but a `dir="auto"` on the name cell is a small fix nobody
  has ticketed.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent change,
and the standing decisions — the Variant A layout, the D3-promoted MVP scope, and file access scoped to
the project root.

**Evidence for this phase:** `npm run typecheck` clean; `npm test` → shared 9, server 257 passed +
8 skipped, web 156 (17 files); `npm run e2e` green, **all five specs**, against the installed Chrome;
`npm run build` green, emitting the five `--color-code-*` tokens and their `text-code-*` utilities.
Driven by hand/Playwright, against `dev:fake` and the `demo` project: a file row held over the folder it
would land in (`evidence/44-drag-target.png`), the confirmation that drop opens
(`evidence/44-move-confirm.png`), and a `.ts` file read as source with its gutter and colours
(`evidence/45-code-view.png`).
