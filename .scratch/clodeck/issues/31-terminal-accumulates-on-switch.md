# 31: Workspace panel grid — the terminal accumulates on project switch

**What to build:** Fix the first bug found by driving the real UI by hand — the one ticket 14 left as a
known gap ("someone should open `npm run dev` and type into the terminal once"). The panel grid
rendered `TerminalPanel` and `FilePanel` as siblings with the *same* key, so React's key map held one
entry per key and the first sibling dropped out of its bookkeeping. Result: switching to another
project left the previous terminal on screen and appended a new one *below* it, growing on every
switch.

**Blocked by:** none

**Status:** resolved

- [x] A real-browser feedback loop reproduces the reported symptom (was: `.xterm` count 1 → 2).
- [x] Root cause identified from React's own warning, not from staring at the panel code.
- [x] Keys in the workspace grid made unique among siblings.
- [x] Regression test at the seam that actually breaks (`App.workspace.test.tsx`), red before the fix.
- [x] The browser loop goes green across repeated switches, with a screenshot.

## Root cause

`WorkspacePlaceholder` (web/src/App.tsx) rendered the right-hand column like this:

```jsx
<div className="grid min-h-0 grid-rows-2 divide-y divide-line">
  <TerminalPanel key={project.id} project={project} />
  <FilePanel key={project.id} project={project} />
</div>
```

Two keyed siblings, both keyed `project.id` — a **duplicate key**. React says so out loud, on every
project selection:

```
Encountered two children with the same key. Keys should be unique so that components
maintain their identity across updates. Non-unique keys may cause children to be
duplicated and/or omitted — the behavior is unsupported.
```

The mechanism, confirmed by reading React's *intended* child list out of the live fiber tree
(`gridFiber.child` → `sibling`) next to the DOM:

- React's reconciliation builds a `Map` from old key → child. With a duplicated key, one entry
  overwrites the other, so the **first** sibling (`TerminalPanel`) falls out of the map.
- On the next project switch every new key is unmatched, so React deletes the children it still knows
  about and inserts the new ones — but the dropped sibling is not in the map, so it is **never
  unmounted**. It stays in the DOM (its section, its socket, its xterm) while a fresh one mounts
  beside it.
- `FilePanel` is the sibling React *kept* in the map, which is why the files drawer was replaced
  correctly and only the terminal duplicated. That asymmetry is the fingerprint.

Instrumented lifecycle logs agree: selecting `demo` logs its mount, but switching to `hello` logs
`PANEL mount id=…hello` with **no `PANEL unmount` for demo and no effect cleanup** — React never tore
the old panel down. The grid's DOM ended up `[section[Terminal], section[Terminal], section[Files]]`
where React held two children, both keyed `hello`.

## What landed

```
web/src/App.tsx                        key={`terminal:${project.id}`} / key={`files:${project.id}`}; WorkspacePlaceholder exported
web/src/App.workspace.test.tsx         the regression test — the workspace grid, switching projects
web/src/testing/xterm-jsdom.ts         the jsdom/xterm stubs, now shared by both terminal tests
web/src/terminal/TerminalPanel.test.tsx  refactored onto the shared stub, scope documented
.scratch/clodeck/debug/                the throwaway Playwright loop that found it (see below)
```

- **The keys carry a panel prefix** — `terminal:${project.id}` and `files:${project.id}`. Both panels
  still remount on a project switch, which is what each key was for; they are just no longer equal to
  each other. Nothing else about the remount contract changed.
- **The regression test is at the grid, not at the panel.** `TerminalPanel.test.tsx` renders the panel
  *alone*, so it can never see a collision with a sibling — it stayed green through the whole bug and
  was the reason the code "looked correct". The new test renders `WorkspacePlaceholder` and rerenders
  it with a second project, which is exactly what `Shell` does (`WorkspacePlaceholder` is not itself
  keyed, so a new project arrives as a prop change). It went red (`expected 2 to be 1`) before the fix
  and green after — in jsdom, with the real xterm.
- **`WorkspacePlaceholder` is now exported** so that seam is reachable from a test. The alternative —
  driving the whole `App` — would have needed the auth session, the login POST and the projects fetch
  stubbed to reach the same grid, without covering anything more of this bug.
- **Three projects' worth of switching** is asserted in the browser loop (demo → hello → demo → hello),
  because the report was accumulation ("this keeps growing"), not just a single duplicate.

## Known gaps

- **The browser loop is not in the test suite.** `.scratch/clodeck/debug/` holds a Playwright config
  and spec that drive the real app in the machine's installed Chrome. It is deliberately outside
  `npm test`: it needs a running dev server and a browser. It is the only check that would have caught
  this bug end-to-end, so it is kept as a clearly-marked debug harness rather than deleted — but
  nothing runs it for you.
- **Playwright's Chromium download fails on this network.** `npx playwright install chromium` dies
  with `Failed to download Chrome for Testing`; the harness works around it with `channel: 'chrome'`
  against the installed browser. A CI job would need its own answer.
- **`@playwright/test` is a `web` devDependency** with no script that uses it. If the debug harness is
  dropped, the dependency should go with it.
- **The `FilePanel`/`ChatPanel` panels were never verified by hand.** Only the terminal bug was chased;
  the rest of the manual pass ticket 14 asked for is still outstanding.
- **jsdom logs `Not implemented: HTMLCanvasElement's getContext()`** once per terminal test. It is
  cosmetic and predates this change (the original stub cast `getContext` the same way); xterm still
  opens and renders a real `.xterm`, which is what the assertions read.

## Evidence

The loop, before the fix — red, on the user's exact symptom:

```
$ UI_PASSWORD=dev npx playwright test --config .scratch/clodeck/debug/playwright.config.ts
[debug] after selecting demo: 1
[debug] after switching to hello: 2
  ✘ 1 failed
    Expected: 1   Received: 2
```

…and the screenshot it captured on failure showed the reported layout exactly: two `TERMINAL` headers
stacked, the upper one still on `PS D:\work\clodeck-projects\demo>` and the lower one on `…\hello>`,
with the files drawer pushed below the fold. (That capture was written to Playwright's output
directory and overwritten by the post-fix run; only `after-fix.png` survives.)

The regression test, before the fix (`npm run test -w web`):

```
FAIL src/App.workspace.test.tsx > the workspace panel grid > leaves exactly one terminal on screen after switching projects
AssertionError: expected 2 to be 1
```

After the fix:

```
$ UI_PASSWORD=dev npx playwright test --config .scratch/clodeck/debug/playwright.config.ts
[debug] after selecting demo: 1
[debug] after switching to hello: 1
[debug] after switching to demo: 1
[debug] after switching to hello: 1
  ✓ 1 passed
```

```
npm run typecheck   → clean
npm test            → shared 7 | server 107 passed, 1 skipped | web 89 passed (9 files)
```

The post-fix screenshot (`.scratch/clodeck/debug/after-fix.png`) shows one `TERMINAL` header on
`…\hello>`, one `FILES` drawer below it, and the layout intact.
