# Handoff — clodeck: the parity pass (tickets 32–45)

**Updated:** 2026-10-12
**Where the tree is:** HEAD is on **`clodeck/33-tool-card-status-badge-ok-token`**
(`b6771ac` + `e9e27e5`), **not merged**. `main` is at `07ea473` — ticket **32** (the scope
catch-up in `AGENTS.md` + `spec-04`) is merged there, and nothing is pushed.

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

**Done:** 32 (merged), 33 (on its branch, reviewed, green).

**Ready, blocked by nothing:** **34** (composer autogrow + the `Enter to send` hint) and **35** (the
drawer shell — rail ▸ sidebar ▸ chat stage, terminal + files in one summonable bottom drawer). Both
are self-contained UI tickets.

**Everything after waits on the drawer:** **36** moves the file panel to `300px tree | code view`
inside the drawer, and **37–44** each add a control to that panel — 37 (success toasts, which 39/42/44
report through), 40 (`size · modified`), 41 (tree ⇄ flat-list), 42 (download + its server route), 43
(markdown `Preview ⇄ Source`), 44 (drag-move + its server route), then 45 (code-view gutter).

Two prototype behaviours deliberately did **not** transfer, and their tickets say why: download needs
a server route (viewer text is truncated and a binary read returns no content, so a client-side `Blob`
would hand back a damaged file), and the flat list cannot recurse (listing is lazy, one directory per
request).

**Then the manual pass.** Only the terminal has ever been driven by hand in a browser; `ChatPanel` and
`FilePanel` have never been clicked through. Tickets 35/36 move both panels, so run the pass *after*
them rather than twice — and watch for the duplicate-key class of bug wherever keyed siblings are
added.

## Known loose ends

- **`README.md:5` still reads "a terminal and a file drawer alongside"** — true of the old two-column
  workspace and made wrong by ticket **35**, which owns the sentence. Deliberately not fixed in 32
  (a scope document's job).
- **Ticket 33's palette token has no test.** jsdom does not process the Tailwind stylesheet, so a test
  could only assert the class name. `npm run build` emitting `--color-ok:#4ea87a` / `.text-ok` was the
  check instead; keep an eye on it if the palette is ever restructured.
- **Parked, deliberately:** make the rendered tests fail on `console.error`. React printed the
  duplicate-key warning to stderr *during* a jsdom run and the suite stayed green. It would be a safety
  net for future bugs, not one that would have caught bug #1 (the panel-alone test produced no
  warning); left until it earns its keep.
- **`main` is ahead of `origin/main` by 8 commits** (`origin/main` is `23d770f`). Nothing is pushed.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent
change, and the standing decisions — including the Variant A layout and the D3-promoted MVP scope
that ticket 32 just landed.

**Evidence:** `npm run typecheck` clean; `npm test` → shared 9, server 230 passed + 7 skipped, web 94
(10 files); `npm run e2e` green as of ticket 31.
