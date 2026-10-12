# Handoff — clodeck: the parity pass (tickets 32–45)

**Updated:** 2026-10-12
**Where the tree is:** HEAD is on **`main`**, matching `origin/main`, with tickets **32** (the scope
catch-up in `AGENTS.md` + `spec-04`), **33** (the tool card's status badge), **34** (the composer grows
with its content and says how to send), **35** (the Variant A workspace: rail + one bottom drawer),
**36** (the file panel as `300px tree | code` inside it) and **37** (success toasts) merged. The ticket
branch is deleted; the next ticket has not been started.

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

**Done:** 32, 33, 34, 35, 36, 37 — all merged.

**The toasts landed, so the file tickets that report through them opened up.** Ready now, blocked by
nothing: **38** (upload drop-overlay cap), **39** (a batch upload's one honest summary — the seam is
37's; until it lands a multi-file upload deliberately says nothing, because a flurry of
overwriting toasts is worse than waiting), **40** (`size · modified` on file rows), **42** (download),
**43** (markdown `Preview ⇄ Source`), **44** (drag-move) and **45** (the code-view gutter). **41**
still waits on **40**.

Two prototype behaviours deliberately did **not** transfer, and their tickets say why: download needs
a server route (viewer text is truncated and a binary read returns no content, so a client-side `Blob`
would hand back a damaged file), and the flat list cannot recurse (listing is lazy, one directory per
request).

**The manual pass keeps growing, still driven by the sessions that built the surfaces** — a weaker
check than a fresh pair of eyes. By hand in Chrome at 1440×900 and 1000×700: the rail and both drawer
tabs, the chat behind the drawer at both sizes, the terminal measured through the DOM at 22 rows /
1083×308 and refitting to 16 rows after a window resize, the files panel with a file open, flipped to
the editor, and its row menu. Through Playwright on the installed Chrome at 1280×720, for tickets
34/37: the composer typed into and measured — 56px empty, 96px at four lines, capped at 160px at
thirty — the hint under it, and a create and a delete against the real project (the toast over the
drawer, the row, the file gone again). **Not** driven: rename and upload by hand, the `ChatPanel`'s
transcript, approvals and history, and the auth flows.

## Known loose ends

- **Ticket 34's async detail is still untrue: nothing disables the textarea while connecting.** Only
  Send is disabled, so the box stays typeable until the socket is live. The ticket's own bullet asks
  only that the hint survive that state, which it does, and the ticket states the textarea *is*
  disabled — so either the box should be disabled or the ticket is describing what it assumed. Left
  for whoever owns that decision rather than smuggled into a hint ticket.
- **A file row near the bottom of the tree opens its `⋯` menu off the scroller's edge.** Ticket 36 put
  the menu back on its row (it was being clipped away entirely before), but the drawer is only 42vh, so
  the last row or two have no room below them. The fix is to flip the menu upward for the lower half of
  the viewport; nobody has claimed it. Ticket 37's toast now shares that corner (bottom-centre, over
  the drawer), so the two want looking at together.
- **The rail stays enabled with no project selected.** Clicking Terminal then records a tab the drawer
  cannot show; choosing a project afterwards opens it. Left as-is by ticket 35 rather than inventing a
  disabled state.
- **Ticket 33's palette token has no test.** jsdom does not process the Tailwind stylesheet, so a test
  could only assert the class name. `npm run build` emitting `--color-ok:#4ea87a` / `.text-ok` was the
  check instead; ticket 37's toast took the same token the same way, so it is now two surfaces on one
  untested token.
- **Parked, deliberately:** make the rendered tests fail on `console.error`. React printed the
  duplicate-key warning to stderr *during* a jsdom run and the suite stayed green. It would be a safety
  net for future bugs, not one that would have caught bug #1 (the panel-alone test produced no
  warning); left until it earns its keep.
- **`origin/main` is current again.** The earlier note that it lagged at `23d770f` is stale: tickets
  31–37 and the parity docs have been pushed.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent
change, and the standing decisions — including the Variant A layout and the D3-promoted MVP scope
that ticket 32 just landed.

**Evidence:** `npm run typecheck` clean; `npm test` → shared 9, server 230 passed + 7 skipped, web 105
(13 files); `npm run e2e` green, re-run against tickets 34/37; `npm run build` green.
