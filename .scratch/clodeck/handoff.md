# Handoff — clodeck: bug hunt (manual browser verification)

**Updated:** 2026-10-12
**Context:** the build is complete (tickets 01–30). We are in the one phase no run had ever covered:
**driving the browser by hand**. **Bug #1 is fixed** — root-caused with a real-browser loop, and
pinned by a regression test at the seam that actually broke. Ticket 31 records it. The fix is in the
working tree, **uncommitted**.

## Dev loop (unchanged, still load-bearing)

Port **3001 is unbindable on this machine** (Windows Hyper-V/WSL exclusion range). Run with `PORT=3300`:

```cmd
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:\work\clodeck-projects
set PORT=3300
npm run dev
rem -> http://localhost:5173    (or npm run dev:fake if there is no API key)
```

## Bug #1 — terminal accumulates on project switch (FIXED)

**Report (verbatim):** selecting a project opens a terminal on the right; switching to another project
leaves the previous terminal on screen and opens a new one *below* it, and this keeps growing. Expected:
the new terminal replaces the old one.

**Root cause: a duplicate key.** `WorkspacePlaceholder` (`web/src/App.tsx`) rendered `TerminalPanel` and
`FilePanel` as siblings both keyed `project.id`. React warns that non-unique keys "may cause children to
be duplicated and/or omitted", and its key map holds one entry per key — so the *first* sibling dropped
out of its bookkeeping and was never unmounted. `FilePanel` was the sibling React kept, which is why only
the terminal duplicated. Fixed with a panel prefix on each key.

**Why the code "looked correct" and two jsdom tests stayed green:** `TerminalPanel.test.tsx` renders the
panel *alone*, so it can never see a collision with a sibling. That is the lesson worth carrying: the
seam was wrong, not the panel. The replacement, `web/src/App.workspace.test.tsx`, renders
`WorkspacePlaceholder` and rerenders it with a second project — red before the fix, green after.

**Full write-up, mechanism and evidence:** `.scratch/clodeck/issues/31-terminal-accumulates-on-switch.md`.

## How the loop was built (now permanent)

The Playwright loop that found bug #1 is a real suite, not scratch:

- `web/playwright.config.ts` — `testDir: './e2e'`, `channel: 'chrome'` with `headless: true` and
  `baseURL: http://localhost:5173`. The Playwright **Chromium download fails on this network**
  (`Failed to download Chrome for Testing`), so it drives the machine's installed Chrome instead. It
  needs the dev loop already up.
- `web/e2e/project-switch.spec.ts` — logs in via `UI_PASSWORD` from the environment, then switches
  demo → hello → demo → hello asserting exactly one `.xterm` throughout.
- `.scratch/clodeck/evidence/31-terminal-switch-after-fix.png` — the post-fix screenshot, with the ticket.

```bash
UI_PASSWORD=dev npm run e2e      # needs `PORT=3300 npm run dev` up in another shell
```

## State of the tree

The fix is **merged to `main`** (`79bd41c`, branch `clodeck/31-terminal-accumulates-on-switch`). It
carries:

- `web/src/App.tsx` — the fix, plus `WorkspacePlaceholder` exported so its seam is testable.
- `web/src/App.workspace.test.tsx` — the regression test (grid, not panel).
- `web/src/testing/xterm-jsdom.ts` — the jsdom/xterm stubs, shared by both terminal tests.
- `web/src/terminal/TerminalPanel.test.tsx` — refactored onto the shared stub, scope documented.
- `web/package.json` + `package-lock.json` — `@playwright/test`, `jsdom`, `@testing-library/react` and
  `@testing-library/dom` devDeps (the first rendered-test infrastructure for the React layer).
- `.scratch/clodeck/issues/31-terminal-accumulates-on-switch.md`, this file, the evidence screenshot.

Evidence at this point: `npm run typecheck` clean; `npm test` → shared 9, server 230 passed + 7 skipped,
web 89 passed (9 files); `npm run e2e` green.

## Guardrails added since (the `/retro` of this session)

- **A pre-commit hook**, `.githooks/pre-commit`, run through `core.hooksPath` — wired by the root
  `prepare` script on every `npm install`. It runs `npm run typecheck` and `npm test`. This repo has no
  CI, and the reason it exists is concrete: a test file once sat in the working tree with
  `npm run typecheck` failing, for a whole session, because nothing ran it.
- **The browser loop is permanent**: `web/e2e/` + `npm run e2e`, documented in the README.
- **`AGENTS.md`'s Finglish line now defines the term** — "Persian written in Latin letters, never in
  Persian script" — after I answered in Persian script and the user had to correct it.

## Parked, deliberately

- **Make the rendered tests fail on `console.error`.** React printed `Encountered two children with the
  same key` to stderr *during* the jsdom run and the suite stayed green; asserting no `console.error`
  in `web/src/testing/` would turn that class of React diagnostic into a failure. Not done yet — it is
  a safety net for future bugs, not one that would have caught this one (the panel-alone test produced
  no warning). Decided with the user to leave it until it earns its keep.

## Next

0. **The prototype↔UI gap list is written: [`prototype-parity.md`](prototype-parity.md).** It is the
   input for the next session's `/to-tickets`: `P0` holds four decisions to settle first (drawer vs
   column; sessions placement; which prototype file features come into MVP; success feedback), then
   `P1`/`P2` are ticket-sized. Nothing in it is an MVP gap — the MVP is built; it is all
   prototype-parity drift and polish.
1. **Carry on the manual pass.** Only the terminal was driven by hand. Ticket 14's known gap asked for
   one terminal exercise and that is what found this; `ChatPanel` and `FilePanel` have never been
   clicked through in a browser, and the same duplicate-key class of bug is worth watching for wherever
   keyed siblings are added.
2. **`main` is ahead of `origin/main` by four commits** — the fix, its merge, the guardrails and their
   merge are all unpushed.
