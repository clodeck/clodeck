# Handoff — clodeck: the loop's own tooling is under the typecheck and the suite

**Updated:** 2026-10-15
**Where the tree is:** with tickets **59, 66, 71 and 72** merged `--no-ff` and their branches deleted, on
top of the ticket-loop runbook (`8b69ba1`). **`739dca5`** is *Merge ticket 72: the loop's tooling comes
under the typecheck and the suite*, and **the merge immediately after it is the one that put this file
on `main`** — read `git log --oneline -3` rather than trusting a SHA written here, since the handoff
cannot name its own merge commit. The 72 branch was cut from `docs/handoff-71`, so merging it brought
that branch's commits with it and `docs/handoff-71` is gone too; `docs/handoff-72` and
`docs/handoff-72-main-sha` went the same way. Nothing is pushed: `main` is **9 commits ahead of
`origin/main`**.

## What this phase is

**Ticket 72 is the loop's own housekeeping: the two files the loop runs on were the only code in the
repo nothing checked.** `.sandcastle/main.mts` and `scripts/tickets.mjs` sat outside every workspace
`tsconfig` and outside `npm test`, and the bill for that was concrete — ticket 71 added `--ticket`,
the flag two lanes depend on, and its only test was a person running it by hand; one strict-mode error
had been sitting at `main.mts:132` because nothing compiled the file.

What it looks like from outside: **`npm run typecheck` and `npm test` now cover the tooling**, and
`npm test` grew a first step, `test:tooling` (2 files, 11 tests, ~180 ms) before the three workspace
suites, which are untouched — the include patterns name `.sandcastle/*.test.mts` and
`scripts/*.test.mts` one level deep, so nothing is collected twice and a leftover worktree cannot drag
a copy of the repo into the run. The tracker takes the directory it reads, so its tests run over a
fixture directory rather than over this effort's own tickets.

## What the merged branch changes

| File | What it now does |
|---|---|
| `tsconfig.tooling.json` | new: the strict baseline (`strict`, `noUncheckedIndexedAccess`, …) over `.sandcastle/*.mts` and `scripts/`, with `allowJs` + `checkJs`. `.sandcastle/` is matched **one level deep** so `worktrees/` — a whole copy of the repo — is never typechecked |
| `vitest.config.mts` | new: the root runner. `npm test` calls it as `test:tooling` before the workspaces; `npm run typecheck` calls `typecheck:tooling` first. Root `devDependencies` gained `vitest`, `typescript`, `@types/node` (they were only hoisted before, which is not a thing to rely on) |
| `.sandcastle/queue.mts` | new: **the host-side choice — which tickets a run will work on — out of `main.mts`**, which reads git config and creates a sandbox as it loads and so cannot be imported. The tracker and the branch list arrive as two ports (`TicketSource`, `Branches`), each with a real implementation that shells out (`ticketTracker()`, `gitBranches()`); `pinnedQueue`, `nextTicket`, `branchOf` and the types moved here unchanged |
| `.sandcastle/main.mts` | now the loop *only*: it builds its two ports and calls `pinnedQueue(...)` with them, and `passTicket()` asks `nextTicket(tickets, branches)`. `main.mts:132` is fixed by narrowing (`?.[1]?.trim()`), not a cast. The local report list is `waitingBranches` (the name `branches` now belongs to the port) |
| `scripts/tickets.mjs` | every exported function takes the directory as its last argument, `CLODECK_ISSUES_DIR` moves the default, and the CLI keeps using the default. Its command line moved into `main(argv)` and **runs only when the file is the process's entry point** — until then, importing it for a test ran the CLI and called `process.exit(1)`. The "no ticket" wording is one `noTicket(id, dir)` shared by the verdict, the close and the CLI |
| `scripts/tickets.test.mts`, `.sandcastle/queue.test.mts` | new: 11 tests, all on behaviour — the four readiness outcomes (ready / blocked / resolved / no such id), the queue's skip report, the CLI driven over a fixture directory through `CLODECK_ISSUES_DIR`, and a pinned run's four answers: the order given, and a refusal with the tracker's own reason, for a ticket pinned twice, or for a branch that is already there |
| `.sandcastle/README.md` | the tracker paragraph gained where the choice now lives, where the tooling tests run, and how the tracker's directory is moved |
| `.scratch/clodeck/issues/72-…` | the ticket, resolved, with a note on the import-time CLI it turned up and on the two review findings |

**The decision the ticket asked for, with its reason:** **the tracker stays `.mjs` and is checked with
`checkJs`.** The implement prompt runs it as `node scripts/tickets.mjs` **inside the sandbox**, where
nothing but Node is guaranteed (the image's own comment says so), and the loop shells out to the same
path on the host. Migrating it to TypeScript would ask a loader of both doors to buy JSDoc-type
inference it already has.

**Evidence:** `npm run typecheck` clean through the pre-commit hook; `npm test` → tooling **11**,
shared **9**, server **276** passed + 8 skipped, web **202** (22 files) — the same three workspace
counts as before the change. The loop's refusals were re-run after the split and are word for word
what they were: `--ticket 9999` (`no ticket 9999 under .scratch/clodeck/issues`), `--ticket 65
--ticket 65`, `--ticket 72` on its own branch, and a typo'd flag. The tracker CLI was driven over a
fixture directory too, which is how the `view` message was caught naming the wrong one.

## What was **not** run, and what it costs

- **Two lanes have still never been run end to end**, and this ticket did not change that: the flag is
  still new, and the first pair belongs on the machine that will host the loop (see the previous
  handoff's account, kept below, and `.sandcastle/README.md`).
- **The new suite has only ever run on this Windows host.** Every sandbox pass now runs it through the
  pre-commit hook, inside the container — which has not happened yet, because no pass has been run
  since. Nothing about it looks host-specific (no shell, no paths, node only) but the first pass is
  where that gets confirmed.
- **`npm test` grew ~200 ms** for the tooling step. That is the cost of the ticket, and it is paid on
  every commit through the hook.

## The loop, as it stands now

- **`npm run sandcastle`** drains the queue, up to `MAX_TICKETS` (6) passes, each a container, an
  `npm ci` and two agents (implement, then review) on that ticket's branch. It never merges and never
  pushes; `.githooks/pre-push` refuses a push from inside the container, which is a guarantee rather
  than a request.
- **`npm run sandcastle -- --ticket 67 [--ticket 65 …]`** works exactly those, in order. Two shells =
  two lanes.
- **`.sandcastle/README.md` is the operator's page** — setup on another machine, `.sandcastle/.env`, the
  image build, the lanes, and the failure-mode list to read when a pass commits nothing. It is more
  current than this file about the loop.
- **The loop's own files are now inside both gates.** `main.mts` is only the loop; anything it decides
  *before* a container exists lives in `queue.mts` and has a test. A change to the loop is still worth
  running once — the refusals are one command each — but it no longer has to be verified *only* by
  running it.

## Where the frontier is

**Ready to start now:** **60** (the web root resolves to the built client), **61** (`npm run serve`,
with a preflight), **62** (the login screen says the connection is not encrypted), **64** (the direct
route, verified in a browser), **65** (the login lockout behind a proxy — the operator's decision to
take), **67** (the provider seam takes its options per run).
**Blocked:** 63 by 60, 61, 62; 68 by 67; 69 by 68; 70 by 69.

The direct-route slice (58–65) and the provider profiles (66–70) are the two live threads, and the loop
can work two of them at once — which is what 71 was for, and 72 is what makes trusting that loop
cheaper.

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
  `--no-verify` only if the user asks. **Since 72 it covers the loop's own files too** — the hook is
  what ran the new tooling suite for the first time on the commit that added it.
- **The browser loop is real, and it is five specs** (`web/e2e/`): `project-switch.spec.ts`,
  `file-upload.spec.ts`, `file-download.spec.ts`, `file-move.spec.ts`, `code-view.spec.ts`, sharing
  `support.ts` (typechecked too). All five need `PORT=3300 npm run dev` (or `dev:fake`) already up, plus
  `UI_PASSWORD`, and they drive the `demo` project, cleaning up what they make. A spec that fails
  mid-test leaves its files in `demo`, and the next run then fails on a `409` that has nothing to do
  with the code: clear `zz-*` out of `D:/work/clodeck-projects/demo` before believing a red run.
- **A docs-only or handoff-only change is not exempt from branching** — this file travelled on
  `docs/handoff-72`, exactly as `AGENTS.md` says. Merging is still `--no-ff` and still the user's call,
  except that this time they made it in advance.

## Behaviour that is still load-bearing (from 44/45/47, untouched since)

- **A project is created by `POST /api/projects { name }`**, `201 { project }`, on the gated scope.
  `400` for a name that is not one clean, non-dot segment; `409` when something is already at the name
  (never overwritten, never followed); `503` when there is no usable projects root — unconfigured,
  absent, **or a plain file**. An unwritable root stays a `500`: a fault, not an empty answer.
- **The write is on the discovery seam, not `ScopedFs`** — `discovery.ts` is still the only module that
  touches the projects root, and the created row's `name`, `path` and `id` all come off the canonical
  path, so a project made by the route and one found by a later rescan are byte-identical rows.
- **`ScopedFs.move(source, destDir)`** returns its own `MoveResult`; `POST /files/move?path=` takes the
  destination **directory** as a *path* (so it passes `relPath`'s syntax check, not `name()`). `409` for
  a collision or a same-directory move, `400` for a destination that is not a directory or a folder into
  its own subtree, `404` for either end missing. **A link as the source is refused; a link as the
  destination is followed** if it stays inside the root.
- **A file row is draggable and a folder row is a drop target**, as is the breadcrumb's root crumb. The
  drag carries `text/plain` and nothing else — a drag advertising `Files` would be read as an OS-file
  upload by the panel's own drop handler (38). Dropping opens `Move "x" into "y"?` first.
- **One dialog, two callers.** `NameDialog` + `Overlay` live in `web/src/dialogs.tsx`; the drawer passes
  `isValidName`, the sidebar `isValidProjectName` (= `isValidName` + non-dot). The overlay is
  `absolute`, so each caller mounts it inside a positioned ancestor.
- **Selection is by id only.** `Shell` sets `selectedId` from the create's answer and calls `reload()`;
  no second copy of a project is held anywhere.

## Known loose ends

**Two lanes pinned to the same ticket still collide** — the branch check is answered per process, so
both pass it and then share a worktree and a log. Recorded on ticket 71 and in `.sandcastle/README.md`;
a host lock was considered and declined there, because it is not what that ticket was about and a lock
file adds its own stale-lock failure mode.

**The tracker's JSON is still taken on trust.** `queue.mts`'s two ports parse the subprocess's output
with `as Ticket[]` / `as Verdict` — casts that moved out of `main.mts` unchanged. The coding standards
rule out casts that quiet the compiler, and these are a boundary assertion rather than a silenced error,
but the honest fix is the field-by-field narrowing `server/src/config.ts` and `ws/client-message.ts`
already do, and testing *that* needs a runner seam this ticket did not ask for. Left deliberately, said
so on the ticket, and worth a small ticket of its own if the loop's output ever comes from anywhere but
this repo's own script.

**The readiness rule is tested through its callers, not directly.** `whyNotReady(ticket, status)` is the
one place "ready" is defined and `list` and a pin both go through it; the four states are asserted at
`readyTicket`, which is the door both use. Nothing calls it that the tests do not reach.

**The list below is the 2026-10-13 snapshot**, minus the four bullets that tickets 54–57 closed (the
client's name rule had no byte cap — 54; a row's `⋯` menu opened off the scroller's edge — 55; a
non-ASCII name rendered as raw bidi — 56; the rail stayed enabled with no project selected — 57). The
rest has not been re-audited since, so read each bullet as of that date and check the ticket before
trusting it.

- **`failureMessage` is copied in four web transports** (`auth/transport.ts`, `files/transport.ts`,
  `chat/useSessions.ts`, `useProjects.ts`) and `messageOf` in six callers; `lstatOrNull`/`isErrno` are
  likewise per-module on the server. Each-module-owns-one is the established pattern — but the count is
  high enough that one shared helper would pay for itself if a fifth caller appears.
- **The move has no keyboard path.** A file is relocated by dragging its row; there is no command for it
  in the row's `⋯` menu, where rename and delete live.
- **The client refuses a same-directory drop after the confirmation, not before it** (44 taken
  literally). Moving the check to the drop is a one-line change.
- **The highlighter is line-based**, as the prototype's was: a `/* … */` block or a multi-line template
  literal is coloured line by line. Deliberate ("a deliberately rough pass, not a parser").
- **`.markdown` is treated as markdown alongside `.md`**, and an extension the map does not list renders
  plain. Both deliberate departures, recorded on ticket 45.
- **`fireEvent.dragLeave` cannot carry `relatedTarget`** in this stack, and jsdom has no `DragEvent` at
  all; the panel test's `dragLeaves` helper dispatches a bubbling `MouseEvent` inside `act`. That is why
  the upload spec's leave test uses `relatedTarget: null`.
- **The code-view spec restates the palette's three hexes as `rgb(…)`** — the point is that the token
  reaches the paint, but re-colouring the code view is a two-file change because of it.
- **`split(line, pattern, kinds, base)` keeps its four arguments** — a review called `pattern` and
  `kinds` a data clump; left as-is because bundling them buys a type for two call sites.
- **The download's toast is optimistic.** It fires on the click, so a file deleted on disk still toasts
  `downloaded x` and the browser saves the 404 body under that name (recorded on ticket 42).
- **A file's `href` is passed through as written** (43): no scheme check, deliberately.
- **spec-04's `FileViewerActions` block is stale** (it still shows `open`/`up`); it carries a note
  saying `web/src/files/useFiles.ts` is the source of truth.
- **Nothing disables the textarea while connecting** — only Send is disabled, so the box stays typeable
  until the socket is live. Needs a decision rather than a smuggled fix (ticket 34's async detail).
- **The palette token has no unit test.** jsdom does not process the Tailwind stylesheet, so a rendered
  test could only assert the class name; `npm run build` emitting the token is the check, and
  `code-view.spec.ts` asserts the resolved colours in a real browser.
- **Parked, deliberately:** make the rendered tests fail on `console.error`. If that lands, the download
  test needs a whitelist entry first — it clicks a real anchor, and jsdom answers with
  `Not implemented: navigation to another Document`.
- **`useFiles.upload` re-lists even when every file in the batch failed**, so a drop that lands nothing
  still costs one listing request. Kept because the batch has one settle path.

## Working agreements worth re-reading

`AGENTS.md` carries them: Finglish-with-Latin-letters for the user, branch first and **stop at the
merge** unless asked (`git switch main && git merge --no-ff <branch>`), one commit per coherent change,
and the standing decisions — the Variant A layout, the D3-promoted MVP scope, file access scoped to the
project root, **a project can be created from the UI**, and **per-session provider profiles** (66, with
endpoint and credential travelling together).
