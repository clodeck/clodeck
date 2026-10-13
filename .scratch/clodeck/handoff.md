# Handoff — clodeck: ticket 46 merged, and a project can be created from the UI

**Updated:** 2026-10-13
**Where the tree is:** HEAD is on **`main`**, with ticket **46** merged (`--no-ff`) and the ticket branch
`clodeck/46-47-create-project-from-ui` deleted. Nothing is pushed. Ticket **47** is written and
`ready-for-agent` — it is the build half of 46's decision and it has **not** been started.

## What this phase is

**Ticket 46 is docs only: no code, no test, no package changed.** It records a decision the user took on
2026-10-13 — **a project can now be created from the UI** — and moves every document that said otherwise
onto it *before* the code ticket (47) is written. It is ticket **32**'s pattern (decision first, features
after), for the same reason: both documents are read at the start of every session, so a stale one is a
re-derivation cost every time.

What the decision reverses, and what it does not, is in `.scratch/clodeck/issues/46-project-creation-decision.md`.
In one line: **the filesystem stays the mechanism, it stops being the only door** — a project is still one
immediate child directory of `PROJECTS_ROOT`, the root is still the allowlist, `id` is still
`base64url(canonical path)`, and the list is still re-scanned per request. What changed is that a create
route (`POST /api/projects`, ticket 47) can now add that directory from the browser — otherwise a user
behind the login with no shell cannot add a project at all, which is the product's whole point.

### The documents that moved (read these before writing 47)

| Document | What it now says |
|---|---|
| `AGENTS.md` §"Standing decisions" | the project line records the second door; the MVP bullet names "creating a project from the sidebar" with its provenance (decision 2026-10-13, ticket 46; built by 47) |
| `.scratch/clodeck/spec.md:19` | story 4 gains the browser door; the drop-a-folder sentence survives, uncut |
| `README.md:141-142` | "Creating one from the sidebar is coming (ticket 47)" beside drop-and-refresh — the button is named as unbuilt, not as a present step |
| `.scratch/web-claude-ui/issues/05-project-discovery.md` | a "Partly superseded — 2026-10-13" note: the scan holds, "drop a folder in is the only door" does not |
| `.scratch/web-claude-ui/map.md:24` | the decision-05 line gains the same superseded clause inline — **the closed wayfinder map is not rewritten** |
| `.scratch/clodeck/prototype-parity.md` §P3 | `add-project` is no longer a mock; search/settings/session-⋯/branch-chip stay mocked |
| `.scratch/clodeck/issues/35-…md` | a dated aside on the rail bullet: the rail's three buttons stand, only its "out of MVP" clause for `add-project` is stale (the button goes in the **sidebar**, not the rail) |

Ticket 46 carries each edit's full detail; the table above is the short form so the next session reads it
without opening the ticket. **No document claims the UI cannot add a project any more** — the one place
that still reads that way is the sidebar's own empty state ("No projects yet. Drop a folder into your
projects root and refresh.", `web/src/ProjectSwitcher.tsx:102`), which is ticket 47's to replace. If 47 is
ever reverted, the seven documents above are the revert's other half — the decision outlives the code on
purpose.

## Where the frontier is

**Done:** 32–46, all merged. **Ready but not started:** ticket **47** (`issues/47-create-project-from-ui.md`)
— blocked-by 46, which is now satisfied. It is a normal code ticket: the `createProject(name)` write on the
discovery seam, the gated `POST /api/projects` route, the sidebar's `New project` button + dialog, and a
`NameDialog` extraction out of `FilePanel.tsx`. Its own **Tests** section is the spec for what to write,
and it deliberately asks for **no e2e spec** — do not "restore" one.

Ticket 46 recorded five calls in 47 that are worth re-reading before starting (a sidebar button not the
rail; a name and nothing else; auto-select the new project; no rename/delete of a project from the UI; no
registry or metadata). Each is reversible and each is stated so it can be argued with.

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
- **The browser loop is real, and it is five specs.** `web/e2e/project-switch.spec.ts` (the accumulation
  bug), `file-upload.spec.ts` (a real `DataTransfer`, the overlay, a one-file and a two-file drop),
  `file-download.spec.ts` (jsdom has no downloads, so only a browser can say which name the disposition
  buys), `file-move.spec.ts` and `code-view.spec.ts` — the drag itself (jsdom has no `DragEvent`) and the
  code column's geometry and colours (jsdom computes neither boxes nor styles). All five need
  `PORT=3300 npm run dev` (or `dev:fake`) already up, `UI_PASSWORD`, and they drive the `demo` project,
  cleaning up what they make. `npm run e2e` from the root. They share their opening — the environment
  check, the login, the row cleanup — through `web/e2e/support.ts`, which is typechecked too.
  **A spec that fails mid-test leaves its files in `demo`**, and the next run then fails on a `409` that
  has nothing to do with the code: clear `zz-*` out of `D:/work/clodeck-projects/demo` before believing a
  red run. **Ticket 47 adds no sixth spec** — a dialog, a fetch and a re-render are none of what jsdom
  cannot see.

## Behaviour from the last code phase (44/45) — unchanged by 46, still current

- **A file row in the tree is draggable and a folder row is a drop target**, and so is the
  **breadcrumb's root crumb**. The drag carries `text/plain` and nothing else — a drag advertising
  `Files` would be read as an OS-file upload by the panel's own drop handler (38), and the two must
  never collide. Dropping opens `Move "x" into "y"?` first; only confirming sends anything.
- **The tree column's header is the breadcrumb now, in both listings.** Ticket 41 gave the trail to the
  flat list and left the tree a plain `in <folder>` line; the root crumb is the only way home for a file
  dragged out of a subfolder, so both listings show the same `root / … / here` trail, and the tree's
  crumb buttons go through the same `openDir` the flat list's do.
- **The server has a cross-directory move.** `ScopedFs.move(source, destDir)` returns its own
  `MoveResult` (the four `WriteResult` arms it shares plus `same_directory`, `into_own_descendant`,
  `not_a_directory`), and `POST /files/move?path=` takes the destination **directory** in the body as a
  *path* — so it passes `relPath`'s syntax check, not `name()`. `relPath` is now thin over a new
  `isRelative`. `409` for a collision or a same-directory move, `400` for a destination that is not a
  directory or a folder into its own subtree, `404` for either end missing. **A link as the source is
  refused; a link as the destination is followed** if it stays inside the root. `spec-04` and ticket 44
  say this now. **Ticket 47's create is the one write that lives beside this, not inside it** — it goes
  on the discovery seam, one level above `ScopedFs`, which refuses its own root by design.
- **The code column's source mode is a numbered, coloured code view** (`web/src/files/code.tsx`): one
  `<ol>` row per line, the number in a fixed-width `select-none`/`aria-hidden` gutter, the line beside it
  in `whitespace-pre` so it scrolls instead of wrapping. The five colours are palette tokens added to
  `index.css`. Preview is still `renderMarkdown`, with no gutter. `highlightLine(line, language) →
  Segment[]` is pure and the segments are React text nodes: nothing here sets `innerHTML`, which is what
  `spec-04` pins.

## Known loose ends

- **Ticket 47 shares one dialog with the drawer.** `NameDialog` (`web/src/files/FilePanel.tsx:1376`) and
  the `Overlay` it shares with the confirm/move dialogs (`:1517`) must move into their own module so both
  the drawer and the new sidebar button use them; `FilePanel.test.tsx` must stay green through the move
  (its queries are by role and label — if it is not, the extraction is wrong, not the test).
- **The move has no keyboard path.** A file is relocated by dragging its row; there is no command for it
  in the row's `⋯` menu, where rename and delete live. The prototype had none either, and the ticket
  asked for the drag — but it is the one row action you cannot reach without a mouse.
- **The client refuses a same-directory drop after the confirmation, not before it.** Ticket 44 said
  "dropping opens the prototype's confirmation", so it is taken literally: the dialog appears, and
  confirming it says `already in <folder>` rather than performing a no-op. Moving the check to the drop
  would be a one-line change.
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
  bottom-centre, over the drawer — now shares that corner with it. Ticket 47's `New project` dialog is in
  the sidebar, not the drawer, so it does not join them.
- **The code-view spec restates the palette's three hexes as `rgb(…)`.** That is the point of it — the
  check is that the token reaches the paint at all — but it does mean re-colouring the code view is a
  two-file change, and it will be asked about once.
- **`split(line, pattern, kinds, base)` keeps its four arguments.** One review called `pattern` and
  `kinds` a data clump; left as-is because bundling them buys a type for two call sites.
- **The download's toast is optimistic.** It fires on the click, because a page is told nothing about a
  download finishing: a file deleted on disk still toasts `downloaded x`, and the browser saves the 404
  body under that name. Recorded on ticket 42.
- **A file's `href` is passed through as written** (ticket 43). No scheme check — the prototype had none
  and the ticket asked for none.
- **spec-04's `FileViewerActions` block is from ticket 20 and is stale** (it still shows `open`/`up`).
  It now carries a note saying `web/src/files/useFiles.ts` is the source of truth.
- **Ticket 34's async detail is still untrue: nothing disables the textarea while connecting.** Only
  Send is disabled, so the box stays typeable until the socket is live. Still needs a decision rather
  than a smuggled fix.
- **The rail stays enabled with no project selected.** Clicking Files then records a tab the drawer
  cannot show; choosing a project afterwards opens it. Left as-is by 35 rather than inventing a disabled
  state.
- **The palette token has no unit test.** jsdom does not process the Tailwind stylesheet, so a rendered
  test could only assert the class name; `npm run build` emitting the token and its utility is the
  check — and `code-view.spec.ts` asserts the *resolved* colours in a real browser.
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
and the standing decisions — the Variant A layout, the D3-promoted MVP scope, file access scoped to the
project root, and now (46) **a project can be created from the UI**.

**Evidence for this phase:** `npm run typecheck` clean; `npm test` → shared 9, server 257 passed + 8
skipped, web 156 (17 files) — unchanged, because ticket 46 is docs only and touched no package. The
`README`/`AGENTS.md`/`spec.md`/`map.md`/`05-project-discovery.md`/`prototype-parity.md`/ticket 35 edits in
the merged commit are the whole change.
