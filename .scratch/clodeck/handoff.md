# Handoff — clodeck: the ticket loop can pin a ticket, so two lanes run at once

**Updated:** 2026-10-15
**Where the tree is:** **`main` is at `8d613ab`** — *Merge ticket 71: the loop can be pinned to one
ticket* — with tickets **59, 66 and 71** merged `--no-ff` and their branches deleted, on top of the
ticket-loop runbook (`8b69ba1`). This session's last change is a docs branch, **`docs/handoff-71`**,
holding this file and one new ticket (72); it is committed and green and **not merged**. Nothing is
pushed: `main` is **3 commits ahead of `origin/main`**. Merging is one command:

```sh
git switch main && git merge --no-ff docs/handoff-71
```

## What this phase is

**Ticket 71 is the loop's own ticket: the run can be told which ticket to work on, which is what makes
two lanes possible.** Before it, `nextTicket()` scanned the ready list and took the first ticket whose
branch did not exist, with nothing serialising that choice — two runs started together both took the
same ticket, and the second either died on `Branch '…' is already checked out in worktree …` or, worse
because it is silent, found that worktree clean, reused it and put a second agent into the same files.

What it looks like from outside: `npm run sandcastle -- --ticket 67 --ticket 65` works exactly those two
tickets, in that order, one per pass; `MAX_TICKETS` stops applying, because the operator named them. Each
id is answered **on the host, before any container exists** — the tracker's new `ready <ID>` gives the
verdict, the branch list gives the rest — and a request that cannot be honoured prints the reason
(`63 is blocked by 60, 61, 62`, `no ticket 999 under .scratch/clodeck/issues`, `71 was pinned twice`,
`clodeck/71-… already exists — merge or delete it first`) and exits 1, rather than quietly working on
something else. Without `--ticket` nothing changed.

Ticket 71's own file (`.scratch/clodeck/issues/71-parallel-ticket-pinning.md`) is the spec, now
`resolved`: its bullets are checked except the seventh, whose account sits just below them — **that one
was run in half, and the file says which half**. Read it before touching the loop.

## What the merged branch changes

| File | What it now does |
|---|---|
| `.sandcastle/main.mts` | `requestedTicketIds()` (strict `parseArgs`, `--ticket` repeatable) and `pinnedQueue()`, which resolves every id against the tracker and the branch list on the host and returns either the tickets or **one** refusal; `passTicket()` shifts from the pinned list or falls through to `nextTicket()`; `passes` is the pin count or `MAX_TICKETS`, and `branchTaken()` builds the already-exists sentence both paths use |
| `scripts/tickets.mjs` | a fourth command, `ready <ID>`, printing `{ ready: true, …ticket }` or `{ ready: false, reason }`; the readiness rule moved into one `whyNotReady(ticket, status)` that `list` and `ready` share, so the queue and a pin cannot disagree about what "ready" means. `list`'s stdout and stderr are byte-identical to before |
| `.sandcastle/README.md` | the lane section rewritten: the two-shell example, what a pinned run refuses and why, what is per-lane (containers `sandcastle-<uuid>`, worktrees and logs per branch), the finding that **`git worktree add` racing itself needs no lock**, the rule that **each lane needs a different ticket**, and the plain statement that two lanes have not been run end to end yet |
| `.scratch/clodeck/issues/71-…` | the ticket, resolved, with its **Landed as**, the half-run account, and a **Code review** section: four fixes (three confusable names, the duplicated refusal sentence, a stack trace where a sentence belongs, a hand re-narrowing) and four declines (no unit tests; no host lock for two lanes on one ticket; the duplicate-pin guard; the README's unrun paragraph) |

**Evidence:** `npm run typecheck` clean; `npm test` → shared **9**, server **276** passed + 8 skipped,
web **202** (22 files); `web/e2e/` is still the same **five** specs. Refusals verified by running:
`--ticket 63`, `--ticket 999`, `--ticket 67 --ticket 67`, `--ticket 71` on 71's own branch,
`--tickets 67`; `--ticket 60 --ticket 61` printed `pass 1/2 — clodeck/60-…` and then stopped at the
Docker image check.

## What was **not** run, and what it costs

**Two lanes have never been run end to end** — not on this machine, which has no Docker daemon and no
built image (both lanes stopped at `Image 'sandcastle:clodeck' not found locally`), and not anywhere
else, because the flag is new. What *was* run is the host half: two processes at once, each claiming its
own ticket and its own branch with no collision, plus the one thing nobody had tried — four concurrent
`git worktree add` claims of exactly Sandcastle's shape, three rounds, zero failures. **So no lock and
no staggered start is needed**, which is the repair ticket 71 asked to be recorded either way.

The first two-lane pair belongs on the machine that will host the loop. Give the lanes tickets from
different parts of the codebase, and give them **different tickets**: the branch check is per process, so
two lanes aimed at one ticket both pass it and then share that branch's worktree and its log.

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
- **The loop's own files are outside the typecheck and the suite** (`npm run typecheck` and `npm test`
  never see `.sandcastle/main.mts` or `scripts/tickets.mjs`, and `main.mts` carries one pre-existing
  strict-mode error at line 132). **That is ticket 72**, written by this session and waiting in the
  queue: bring them under the typecheck, give `scripts/tickets.mjs` an injectable `ISSUES_DIR`, and put
  a root runner in front of them. Until it lands, a change to the loop is verified by running it.

## Where the frontier is

**Ready to start now:** **60** (the web root resolves to the built client), **61** (`npm run serve`,
with a preflight), **62** (the login screen says the connection is not encrypted), **64** (the direct
route, verified in a browser), **65** (the login lockout behind a proxy — the operator's decision to
take), **67** (the provider seam takes its options per run) and **72** (this session's tooling ticket).
**Blocked:** 63 by 60, 61, 62; 68 by 67; 69 by 68; 70 by 69.

The direct-route slice (58–65) and the provider profiles (66–70) are the two live threads; the loop can
work two of them at once now, which is the whole point of 71.

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
  `--no-verify` only if the user asks. **It does not cover the loop's own files** — see ticket 72.
- **The browser loop is real, and it is five specs** (`web/e2e/`): `project-switch.spec.ts`,
  `file-upload.spec.ts`, `file-download.spec.ts`, `file-move.spec.ts`, `code-view.spec.ts`, sharing
  `support.ts` (typechecked too). All five need `PORT=3300 npm run dev` (or `dev:fake`) already up, plus
  `UI_PASSWORD`, and they drive the `demo` project, cleaning up what they make. A spec that fails
  mid-test leaves its files in `demo`, and the next run then fails on a `409` that has nothing to do
  with the code: clear `zz-*` out of `D:/work/clodeck-projects/demo` before believing a red run.
- **A docs-only or handoff-only change is not exempt from branching** — this file travelled on
  `docs/handoff-71`, exactly as `AGENTS.md` says.

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

**Two are new here:** the loop's tooling is outside the typecheck and the suite (**ticket 72**, in the
queue), and **two lanes pinned to the same ticket still collide** — the branch check is answered per
process, so both pass it and then share a worktree and a log. Recorded on ticket 71 and in
`.sandcastle/README.md`; a host lock was considered and declined there, because it is not what that
ticket was about and a lock file adds its own stale-lock failure mode.

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
