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

## How the loop was built (reusable)

`.scratch/clodeck/debug/` is a **throwaway debug harness**, deliberately outside `npm test`:

- `playwright.config.ts` — `channel: 'chrome'` with `headless: true` and `baseURL: http://localhost:5173`.
  The Playwright **Chromium download fails on this network** (`Failed to download Chrome for Testing`),
  so the harness drives the machine's installed Chrome instead. It needs the dev loop already up.
- `terminal-switch.spec.ts` — logs in via `UI_PASSWORD` from the environment, then switches
  demo → hello → demo → hello asserting exactly one `.xterm` throughout.
- `after-fix.png` — the post-fix screenshot.

```bash
UI_PASSWORD=dev npx playwright test --config .scratch/clodeck/debug/playwright.config.ts
```

**Unresolved housekeeping:** `@playwright/test` is a `web` devDependency that no script uses. Keep the
harness and it is a working tool; drop the harness and the dependency should go with it.

## Working tree (uncommitted)

- `web/src/App.tsx` — **the fix**: `key={`terminal:${project.id}`}` / `key={`files:${project.id}`}`;
  `WorkspacePlaceholder` exported so its seam is testable.
- `web/src/App.workspace.test.tsx` — **new**; the regression test.
- `web/src/testing/xterm-jsdom.ts` — **new**; the jsdom/xterm stubs, shared by both terminal tests.
- `web/src/terminal/TerminalPanel.test.tsx` — refactored onto the shared stub, scope documented.
- `web/package.json` + `package-lock.json` — `@playwright/test`, `jsdom`, `@testing-library/react` and
  `@testing-library/dom` devDeps (the first rendered-test infrastructure for the React layer).
- `.scratch/clodeck/debug/`, `.scratch/clodeck/issues/31-terminal-accumulates-on-switch.md`,
  this file.

Evidence at this point: `npm run typecheck` clean; `npm test` → shared 7, server 107 passed + 1 skipped,
web 89 passed (9 files).

## Next

1. **Commit the fix** (the tree has been uncommitted since the bug was found — it is settled now).
2. **Carry on the manual pass.** Only the terminal was driven by hand. Ticket 14's known gap asked for
   one terminal exercise and that is what found this; `ChatPanel` and `FilePanel` have never been
   clicked through in a browser, and the same duplicate-key class of bug is worth watching for wherever
   keyed siblings are added.
3. **`/retro`** on this session, while it is still in context.
