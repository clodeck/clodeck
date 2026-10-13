# Handoff — clodeck: ticket 47 is merged, and the README has a first-run path

**Updated:** 2026-10-13
**Where the tree is:** **`main` has ticket 47 merged** (`50eb99a`, `--no-ff`, and the branch
`clodeck/47-create-project-from-ui` deleted), and this session's last change is a docs branch —
**`docs/readme-first-run`** — which rewrites the README's first-run path and corrects this file. That
branch is committed and green, and **not merged**; nothing is pushed. Merging it is one command:

```sh
git switch main && git merge --no-ff docs/readme-first-run
```

The correction this file needed: the previous version was written before the merge and said 47 was
still on a branch.

## What this phase is

**Ticket 47 is the build half of ticket 46's decision.** 46 said a project can be created from the UI
and moved every document onto that; 47 is the code: one `mkdir` under the projects root, one gated
route, and the sidebar button and dialog in front of it. The product rule it lands is unchanged —
a project is still one immediate child directory of `PROJECTS_ROOT`, the root is still the allowlist,
`id` is still `base64url(canonical path)`, and the list is still re-scanned per request. What is new is
that the browser is now a door as well as the filesystem.

What it looks like from outside: the sidebar's header carries `New project` beside Refresh; the button
opens the app's one name dialog; `Create` POSTs `{ name }` to `/api/projects`; the dialog closes, the
list reloads, the new project becomes the selected one, and a `created <name>` toast says so. The empty
state carries the same button, so "no projects yet" is no longer a dead end for someone with no shell.

Ticket 47's own file (`.scratch/clodeck/issues/47-create-project-from-ui.md`) is the spec, now
`resolved`: its twelve bullets are checked, its **Landed as** block names every file, three build calls
are recorded (the `projects.ts` module move, the widened `no_root`, the canonical `name`), and its
**Code review** section lists the three fixes and the three declines. Read it before touching any of
this — it is the shortest accurate description of what is there.

## What the merged branch changes

| File | What it now does |
|---|---|
| `server/src/discovery.ts` | `createProject(name)` on the discovery seam: `name()` for the segment, discovery's leading-dot rule, an `lstat` pre-check, a non-recursive `mkdir`, then canonicalization — the id, path **and** name all come off the canonical path |
| `server/src/projects.ts` | **new**: `registerProjectRoutes` — `GET /projects` moved here from `app.ts`, the new `POST /projects` beside it, and the `201`/`400`/`409`/`503` mapping |
| `server/src/app.ts` | one line replaced: the two project routes are registered together on the gated scope |
| `web/src/dialogs.tsx` | **new**: `NameDialog` + `Overlay`, extracted from `FilePanel` — the validity rule became a prop (a project name is a drawer name *and* non-dot) |
| `web/src/files/FilePanel.tsx` | imports the two, passes `isValidName`; `FilePanel.test.tsx` never noticed, which was the extraction's test |
| `web/src/useProjects.ts` | `create` on the hook, `createProject` (the POST) behind it, and `isValidProjectName` |
| `web/src/ProjectSwitcher.tsx` | the `New project` button, the dialog, the toast, and the empty state's button |
| `web/src/App.tsx` | `Shell` creates → selects the id → reloads; `Workspace` passes the create down |
| `web/src/App.projects.test.tsx` | **new**: the flow through the real shell with `fetch` stubbed |

**Evidence:** `npm run typecheck` clean; `npm test` → shared **9**, server **267** passed + 8 skipped,
web **161** (18 files). Against the previous phase that is +10 server (4 discovery + 6 route) and +5
web. No e2e spec was added, deliberately — the ticket says so twice, and the reason holds: a dialog, a
fetch and a re-render are what jsdom *can* see, and the filesystem effect is pinned against real temp
roots on the server side. `web/e2e/` is still the same five specs.

## What `docs/readme-first-run` changes

Docs only — `README.md`, and this file. The README's `Try it` (three bash-only lines that explained
nothing) became **Bring it up**: seven numbered steps that walk a person on any OS from `npm install`
to a signed-in browser — install, make a projects root, start it (bash/PowerShell/CMD/Git Bash), open
it and sign in (with the layout drawn out and the boot lines to expect), what to do first, the no-Vite
variant, and the fake provider — each step saying *why* it exists. `## Requirements` became a table
worth checking off, and the 502 passage became `## Troubleshooting`: the reserved port, the sidebar
that stays empty, the password that will not log in, and the chat turn that needs the API key. **A
new session should read [Bring it up](../../README.md#bring-it-up) instead of reconstructing the dev
loop from this file** — the two agree; the README is the one a human follows.

## Where the frontier is

**Done:** 32–47, the last of them merged. **Nothing is ready-but-unstarted**: there is no queued
ticket.

The next phase starts by re-reading `AGENTS.md`'s standing decisions and the "Known loose ends" below
— with no ticket waiting, its first job is to pick one (§P-lists in
`.scratch/clodeck/prototype-parity.md` are empty; the loose ends are where the real work is).

## Dev loop (unchanged, still load-bearing)

Port **3001 is unbindable on this machine** (Windows Hyper-V/WSL exclusion range). Run with `PORT=3300`,
and **give `PROJECTS_ROOT` forward slashes**: Git Bash eats the backslashes in an env assignment, and
the server then scans `<repo>\workclodeck-projects` and discovers nothing — an empty project list, with
the reason only in its warn line.

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
  red run. **Ticket 47 adds no sixth spec** — do not "restore" one.

## Behaviour from the last code phase (47) — new, and load-bearing

- **A project is created by `POST /api/projects { name }`**, `201 { project }`, on the same gated scope
  as every other `/api` route. `400` for a name that is not one clean, non-dot segment; `409` when
  something is already at the name (never overwritten, never followed — a symlink at the name is `409`
  too, unlike the drawer's `400`, because nothing is written *through* anything here); `503` when there
  is no usable projects root — unconfigured, absent, **or a plain file**, since `mkdir` says `ENOENT` on
  Windows and `ENOTDIR` elsewhere for that last one. An unwritable root stays a `500`: that is a fault,
  not an empty answer.
- **The write is on the discovery seam, not `ScopedFs`** — it is the root-level sibling of both, and
  `ScopedFs` refuses its own root by design. `discovery.ts` still is the only module that touches the
  projects root.
- **The created row's `name`, `path` and `id` all come off the canonical path** (`path.basename`,
  `toProjectId`), exactly as `resolveProject` reads them: a project made by the route and one found by
  a later rescan are byte-identical rows.
- **One dialog, two callers.** `NameDialog` and its `Overlay` live in `web/src/dialogs.tsx`; the drawer
  passes `isValidName`, the sidebar passes `isValidProjectName` (= `isValidName` + non-dot). The
  overlay is `absolute`, so each caller mounts it inside a positioned ancestor — the drawer's panel,
  and now the sidebar's `section` (`relative` for exactly that reason).
- **Selection is by id only.** `Shell` sets `selectedId` from the create's answer and calls `reload()`;
  the row itself arrives with the reload and `Workspace`'s derived `selected` resolves it. No second
  copy of a project is held anywhere, which is why the toast names the project the user typed and not a
  stored object.

## Behaviour from the phase before (44/45) — still current, unchanged by 47

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
  *path* — so it passes `relPath`'s syntax check, not `name()`. `409` for a collision or a same-directory
  move, `400` for a destination that is not a directory or a folder into its own subtree, `404` for
  either end missing. **A link as the source is refused; a link as the destination is followed** if it
  stays inside the root. Ticket 47's create is the one write that lives *beside* this, not inside it.
- **The code column's source mode is a numbered, coloured code view** (`web/src/files/code.tsx`): one
  `<ol>` row per line, the number in a fixed-width `select-none`/`aria-hidden` gutter, the line beside it
  in `whitespace-pre` so it scrolls instead of wrapping. The five colours are palette tokens added to
  `index.css`. Preview is still `renderMarkdown`, with no gutter. `highlightLine(line, language) →
  Segment[]` is pure and the segments are React text nodes: nothing here sets `innerHTML`, which is what
  `spec-04` pins.

## Known loose ends

- **The client's name rule has no byte cap.** `isValidName` (`web/src/files/reducer.ts`) refuses an
  empty/`.`/`..`/separator/NUL name but not one over 255 bytes, while the server's `name()` does — so
  the dialog enables a 256-character name the server then refuses with `400`. Pre-existing (the
  drawer's own create has it too, since ticket 20), and the server's message does reach the dialog; the
  fix belongs to `isValidName` itself, and there is no ticket for it. Ticket 47's review declined to
  fix it there deliberately.
- **`failureMessage` is now copied in four web transports** (`auth/transport.ts`,
  `files/transport.ts`, `chat/useSessions.ts`, `useProjects.ts`) and `messageOf` in six callers;
  `lstatOrNull`/`isErrno` are likewise per-module on the server. Each-module-owns-one is the established
  pattern, and 47's review declined to refactor four untouched modules for it — but the count is now
  high enough that one shared helper would pay for itself if a fifth caller appears.
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
  bottom-centre, over the drawer — shares that corner with it. The `New project` dialog is in the
  sidebar, not the drawer, so it does not join them.
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
  state. (A create now lands *with* a selection, so this is the pre-create window only.)
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
  has ticketed. **A project row has the same shape**: a project whose directory name is non-ASCII will
  read backwards in the sidebar.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent change,
and the standing decisions — the Variant A layout, the D3-promoted MVP scope, file access scoped to the
project root, and now (46/47) **a project can be created from the UI**, which is built, not pending.
