# Handoff — clodeck: the parity pass continues (tickets 32–40)

**Updated:** 2026-10-12
**Where the tree is:** HEAD is on **`main`**, matching `origin/main`, with tickets **32** (the scope
catch-up in `AGENTS.md` + `spec-04`), **33** (the tool card's status badge), **34** (the composer grows
with its content), **35** (the Variant A workspace: rail + one bottom drawer), **36** (the file panel as
`300px tree | code`), **37** (success toasts), and now **38** (the drop overlay and one cap for both
sides), **39** (an upload batch's one honest summary) and **40** (`size · modified` on file rows) merged.
The ticket branch is deleted; the next ticket has not been started.

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
npm run dev
rem -> http://localhost:5173    (or npm run dev:fake if there is no API key)
```

## Guardrails (do not lose these)

- **The pre-commit hook** (`.githooks/pre-commit`, wired through `core.hooksPath` by `npm install`) runs
  `npm run typecheck` and `npm test`. There is no CI; the hook is why a red tree cannot be committed.
  `--no-verify` only if the user asks.
- **The browser loop is real, and it just grew a second spec.**
  `web/e2e/project-switch.spec.ts` (the accumulation bug) and now `web/e2e/file-upload.spec.ts`, which
  drives tickets 38–40 on the installed Chrome: a real `DataTransfer`, the overlay appearing and
  clearing, a one-file drop, and a two-file drop that loses one. It exists because **jsdom has no
  `DragEvent`** — `fireEvent.dragOver` hands the handler a plain `Event` with a `dataTransfer` bolted on,
  so the overlay's `pointer-events-none` (what lets a drag pass through to the panel beneath) is a thing
  only a browser can see. It writes into the project it drives and deletes what it uploaded through the
  row menu, so it leaves `D:\work\clodeck-projects\demo` as it found it. Both specs need
  `PORT=3300 npm run dev` already up, and `UI_PASSWORD` in the environment.

## Where the frontier is

**Done:** 32, 33, 34, 35, 36, 37, 38, 39, 40 — all merged.

**Ready now, blocked by nothing:** **41** (the tree ⇄ flat-list toggle — it waited on 40, which is what
gave it the formatter the Size and Modified columns read), **42** (download, which needs a server route:
the viewer's text is truncated and a binary read returns no content, so a client-side `Blob` would hand
back a damaged file), **43** (markdown `Preview ⇄ Source`), **44** (drag-move — the server has no
cross-directory move yet, and its row drag is exactly what 38's `hasOsFiles` gate keeps apart from an
upload), and **45** (the code-view gutter and highlight).

## Behaviour that changed under this phase (read before touching these surfaces)

- **Upload failures speak through the toast alone.** Ticket 37's inline error bar in the tree column
  (with its dismiss button) is deleted. That is deliberate and it overrides one of 37's landed bullets
  ("a success toast never replaces an error surface"): 39 asks for exactly one message per batch and 38
  names 37's surface as the home for an oversize refusal. The cost is real — a failure's reason is on the
  toast's second line and goes away with it after 2.2s, where the bar used to stay until dismissed. If
  that turns out to be the wrong trade for a slow reader, the fix is a ticket, not a revert of the batch.
- **The toast is no longer success-only.** `1 failed` wears the same `ok` accent as `file x created`.
  Left as-is rather than growing the toast's API a tone parameter.
- **The drop overlay highlights the whole panel while the batch lands in the *active* folder** (what the
  breadcrumb's `in root` names). That is the prototype's behaviour — its overlay covered the whole file
  wrapper — and the active folder is where create and upload have always landed.
- **A file row's tooltip is on the row**, not on the size text. The name button carries its own
  `Preview x` title, so hovering the name shows that; the timestamp arrives over the size and the
  whitespace around it.

## Known loose ends

- **Ticket 34's async detail is still untrue: nothing disables the textarea while connecting.** Only Send
  is disabled, so the box stays typeable until the socket is live. Unchanged by this phase; still needs a
  decision rather than a smuggled fix.
- **A file row near the bottom of the tree opens its `⋯` menu off the scroller's edge** (ticket 36 put
  the menu back on its row; the 42vh drawer leaves the last row or two no room below). The fix is still
  to flip the menu upward for the lower half of the viewport, and ticket 37's toast — bottom-centre, over
  the drawer — now shares that corner with it.
- **The rail stays enabled with no project selected.** Clicking Files then records a tab the drawer
  cannot show; choosing a project afterwards opens it. Left as-is by 35 rather than inventing a disabled
  state.
- **The palette token has no test.** jsdom does not process the Tailwind stylesheet, so a test could only
  assert the class name; `npm run build` emitting `--color-ok:#4ea87a` / `.text-ok` is the check. It is
  now three surfaces on that token (33's badge, 37's toast, 39's summary).
- **Parked, deliberately:** make the rendered tests fail on `console.error` — a safety net for future
  bugs, not one that would have caught bug #1.
- **New, small:** `useFiles.upload` re-lists even when every file in the batch failed, so a drop that
  lands nothing still costs one listing request. Kept because the batch has one settle path; a failure
  count that needs no re-list is not worth a second one.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent change,
and the standing decisions — the Variant A layout, the D3-promoted MVP scope, and file access scoped to
the project root.

**Evidence for this phase:** `npm run typecheck` clean; `npm test` → shared 9, server 230 passed + 7
skipped, web 126 (15 files); `npm run e2e` green, both specs, against the installed Chrome;
`npm run build` green. Driven by hand/Playwright: the overlay appearing on an OS-file drag and clearing
on drag-leave (`evidence/38-drop-overlay.png`), and a two-file drop that lost one reporting
`1 uploaded · 1 failed` over `409 Conflict: already exists` with both rows in their real state
(`evidence/39-mixed-batch-toast.png`).
