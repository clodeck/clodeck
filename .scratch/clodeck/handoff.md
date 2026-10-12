# Handoff — clodeck: the parity pass (tickets 32–45)

**Updated:** 2026-10-12
**Where the tree is:** HEAD is on **`clodeck/35-36-drawer-shell-and-file-columns`**, two commits —
ticket **35** (the Variant A workspace: rail + one bottom drawer) and ticket **36** (the file panel as
`300px tree | code` inside it) — **not yet merged**, and awaiting the user's word on merging. That is
the whole of what is unlanded: `main` already carries **32** (the scope catch-up in `AGENTS.md` +
`spec-04`) and **33** (the tool card's status badge). 35's commit carries 36's `flex-1`, so the tree is
coherent at each commit. Nothing is pushed.

## What this phase is

The build is complete (tickets 01–30) and the prototype↔UI gap list is settled, ticketed and now
being worked: **issues 32–45**, from `prototype-parity.md` §"Tasmim-haye gerefte-shode". Nothing in
that list is an MVP gap — the MVP is built; it is all parity drift and polish. Ticket 31 (a real bug,
fixed) is behind us and lives in `issues/31-terminal-accumulates-on-switch.md`.

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

- **The pre-commit hook** (`.githooks/pre-commit`, wired through `core.hooksPath` by `npm install`)
  runs `npm run typecheck` and `npm test`. There is no CI; the hook is why a red tree cannot be
  committed. `--no-verify` only if the user asks.
- **The browser loop is real**: `web/e2e/project-switch.spec.ts` + `npm run e2e` (drives the machine's
  installed Chrome — the Playwright Chromium download fails on this network — so it needs
  `PORT=3300 npm run dev` already up). It found bug #1; see `issues/31-…md` for what a panel-alone
  test cannot see.

## Where the frontier is

**Done:** 32 (merged), 33 (merged), 35 + 36 (on the branch above, awaiting a merge decision).

**The drawer landed, so its dependents opened up.** Ready now, blocked by nothing: **34** (composer
autogrow + the `Enter to send` hint), **37** (success toasts — 33's `ok` token and 36's panel are both
in), **38** (upload drop-overlay cap), **40** (`size · modified` on file rows), **43** (markdown
`Preview ⇄ Source`), **45** (the code-view gutter). Still waiting: **39** and **42** and **44** on 37,
**41** on 40.

Two prototype behaviours deliberately did **not** transfer, and their tickets say why: download needs
a server route (viewer text is truncated and a binary read returns no content, so a client-side `Blob`
would hand back a damaged file), and the flat list cannot recurse (listing is lazy, one directory per
request).

**The manual pass is now partly done — by the same session that built the drawer**, which is a weaker
check than a fresh pair of eyes. Driven by hand in Chrome at 1440×900 and 1000×700: the rail and both
drawer tabs, the chat behind the drawer at both sizes, the terminal measured through the DOM at 22 rows
/ 1083×308 and refitting to 16 rows after a window resize, the files panel with a file open, flipped to
the editor, and its row menu. **Not** driven: the file operations themselves (new file, new folder,
rename, delete, upload), the `ChatPanel`'s transcript, approvals and history, and the auth flows —
`FilePanel`'s and `ChatPanel`'s interiors have still never been clicked through.

## Known loose ends

- **A file row near the bottom of the tree opens its `⋯` menu off the scroller's edge.** Ticket 36 put
  the menu back on its row (it was being clipped away entirely before), but the drawer is only 42vh, so
  the last row or two have no room below them. The fix is to flip the menu upward for the lower half of
  the viewport; nobody has claimed it.
- **The rail stays enabled with no project selected.** Clicking Terminal then records a tab the drawer
  cannot show; choosing a project afterwards opens it. Left as-is by ticket 35 rather than inventing a
  disabled state.
- **Ticket 33's palette token has no test.** jsdom does not process the Tailwind stylesheet, so a test
  could only assert the class name. `npm run build` emitting `--color-ok:#4ea87a` / `.text-ok` was the
  check instead; keep an eye on it if the palette is ever restructured.
- **Parked, deliberately:** make the rendered tests fail on `console.error`. React printed the
  duplicate-key warning to stderr *during* a jsdom run and the suite stayed green. It would be a safety
  net for future bugs, not one that would have caught bug #1 (the panel-alone test produced no
  warning); left until it earns its keep.
- **`main` carries unpushed commits.** `origin/main` is still `23d770f`; everything since — tickets
  31, 32, 33, 35 and 36, plus the parity docs — exists only locally.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent
change, and the standing decisions — including the Variant A layout and the D3-promoted MVP scope
that ticket 32 just landed.

**Evidence:** `npm run typecheck` clean; `npm test` → shared 9, server 230 passed + 7 skipped, web 96
(11 files); `npm run e2e` green, re-run against tickets 35/36's drawer. `npm run build` green.
