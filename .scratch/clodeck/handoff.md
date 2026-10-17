# Handoff — clodeck: the composer has a `/` menu, and `/clear` finally clears

**Updated:** 2026-10-17
**Where the tree is:** with tickets **75 and 76** merged `--no-ff` and their branches deleted, on top of
the 2026-10-15 loop handoff. **The two merge commits are `5e08435` and `47a3768`**, and **the merge
immediately after them is the one that put this file on `main`** — read `git log --oneline -3` rather
than trusting a SHA written here, since the handoff cannot name its own merge commit. The 76 merge
needed one hand resolution, because both branches added a caller to the same two seams (see **The
merge** below). **This handoff is pushed with them**, so the live server can pull; how far `main` runs
ahead afterwards is `git rev-list --count origin/main..main`, which a handoff cannot keep. The server's
update stays `git pull && npm ci && npm run build && sudo systemctl restart clodeck`
(`scripts/deploy-clodeck.sh:816`) — a pull alone changes nothing, because the unit runs the compiled
`dist/main.js` — and a restart drops every session.

## What this phase is

**A feature and the bug it exposed, both decided in one grilling session and both built by the loop.**
The feature is the composer's `/` menu: `/` lists the session's own commands, filtered by every
character typed, and an entry inserts rather than sends. The bug is the one the grilling turned up on
the way past — clodeck dropped the SDK's `conversation_reset`, so a `/clear` left the pre-clear
transcript on screen and a reconnect spliced the two together.

**Ticket 75 was charted from the grilling, not from a build run.** Eleven decisions were settled before
any code existed, and the two that decided the shape were measurements rather than opinions: the run is
**lazy** (`startRun` ← `provider.query` ← `sendPrompt` ← `bus.ts:123`, one path), so no `init` can
arrive before the first send; and `Query.supportedCommands()` needs no prompt, so the SDK's list is
authoritative as soon as a run exists.

**The menu never becomes a second way to send.** `/name` already worked as prompt text; the menu makes
it discoverable. It adds nothing to the send path.

## What the merged branches change

| File | What it now does |
|---|---|
| `shared/src/commands.ts` | new: `SlashCommand` — one shape for the three places a command travels (the SDK mirror, the protocol payload, the disk route) |
| `shared/src/sdk.ts` | `SDKSystemCommandsChangedMessage`, `terminal_slash_commands` on `init`, and the mirrored `conversation_reset` |
| `shared/src/protocol.ts` | a new `commands` kind and `SnapshotPayload.commands?` — absent while the run has listed nothing |
| `server/src/commands.ts` | new: `GET /api/projects/:id/commands` and the disk reader — skills, `.claude/commands/**` with `:` namespacing, a small frontmatter subset, `user-invocable: false`, parents up to `PROJECTS_ROOT`, no cache |
| `server/src/discovery.ts` | `canonicalRoot()` — the one accessor for the one reader that walks *above* a project and stops at the root |
| `server/src/sdk/{provider,anthropic}.ts` | `SdkRun.supportedCommands()`; `commands_changed` annotated in the mirror (the compile-time pin) |
| `server/src/ws/turn-manager.ts` | `listCommands()` once per run, broadcast as `commands`; `forgetTranscript()` — the one spelling of "the run forgets this conversation", with two callers: `clear_resume` and the SDK's `conversation_reset` |
| `web/src/chat/reducer.ts` | folds `commands`/`commands_changed` by **replace**, filters `terminal_slash_commands`, and resets to `runState()` on `conversation_reset` |
| `web/src/chat/{useCommands.ts,CommandMenu.tsx}` | fetch on mount and on every open; the listbox panel with substring matching |
| `web/src/chat/{Composer,ChatPanel}.tsx` | the token/caret trigger, the keyboard, insert and hint; the source choice (the run's list if it has one, the project's files otherwise) |
| `web/e2e/command-menu.spec.ts` | the browser spec; it builds and cleans up its own fixture (`zz-e2e-menu.md`) |
| `.scratch/clodeck/evidence/75-command-menu*.png` | two screenshots: the disk list and the run's list |

**Measurements the implement agent took against the real SDK** — they answer what the ticket could not:
`commands_changed` does **not** push at start (so `supportedCommands()` is not optional); the SDK
itself hides `user-invocable: false` skills; parent `.claude/skills` really do load; a skill's
frontmatter `name` outranks its directory, but a command file's `name:` changes nothing;
`disable-model-invocation: true` does **not** hide a command from `/`; and a real session reports
**70 commands** with `/doctor`, `/color`, `/focus` and `/reload-plugins` absent because they are
`terminal_slash_commands` — the client filter is tested against that data, not a guess.

## The merge

Both branches added a caller to the same two seams, so the merge conflicted in `turn-manager.ts` and
`reducer.ts` and was resolved by hand, keeping both features:

- `forgetTranscript` (76) stays the one spelling of the reset and now also clears `state.commands`, the
  list 75 put on the run: the list belongs to the session that reported it, and the next run reports
  its own.
- `fromSnapshot` builds on 76's `runState(...)` and seeds 75's `commands` on top of it, still before
  the blocks, so a later `commands_changed` replayed among them is the one that stands.

**Evidence:** `npm run typecheck` clean and `npm test` green through the pre-commit hook on both merge
commits — tooling **25**, shared **10**, server **374** passed + 8 skipped, web **261** (29 files).

## What was **not** run, and what it costs

- **The merged tree has not been through a browser.** Ticket 75's implement pass took its own browser
  evidence (the two screenshots above) and wrote `web/e2e/command-menu.spec.ts`, but nobody ran
  `npm run e2e` after the merge. The six specs still need `PORT=3300 npm run dev` (or `dev:fake`) and
  `UI_PASSWORD`; the unit suites cover both features separately and together, and the browser check of
  the *combination* is the gap.
- **The reset path has no browser spec of its own.** `conversation_reset` is covered by
  `server/src/ws/bus.test.ts` and `web/src/chat/reducer.test.ts`, not by a real session typing
  `/clear`.
- **The two-lane collision from the 2026-10-15 handoff is unchanged.** This run was one process with
  two pinned tickets (`--ticket 75 --ticket 76`), not two shells — but the run itself went through on
  this Windows host: a container, an `npm ci` and both agents per pass.
- **`npm test` grew ~200 ms** for the tooling step, and the two new suites add a little more. That is
  the cost, paid on every commit through the hook.

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

**Nothing is ready.** Every ticket under `.scratch/clodeck/issues/` is `resolved` through **76**, so
`node scripts/tickets.mjs list` prints an empty queue and `npm run sandcastle` has nothing to pick up
until a new ticket is written. The next move is a new decision, not a backlog item:

- **Eager session start** — spawn the run when a chat opens, so built-ins appear on a `/` pressed on an
  empty chat — is recorded in ticket 75 as deliberately out of scope: it changes what "New chat" means
  (74) and wants its own ticket.
- **`npm run e2e` against the merged tree**, and a browser look at `/clear`, are the two verifications
  this phase left for whoever picks it up.

Otherwise a new phase starts where this one did: a grilling, then a ticket.

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
- **The browser loop is real, and it is six specs** (`web/e2e/`): `project-switch.spec.ts`,
  `file-upload.spec.ts`, `file-download.spec.ts`, `file-move.spec.ts`, `code-view.spec.ts`,
  `command-menu.spec.ts` (new in 75 — it makes and cleans up its own `zz-e2e-menu.md`, and leaves a
  folder that was already there alone), sharing `support.ts` (typechecked too). All six need
  `PORT=3300 npm run dev` (or `dev:fake`) already up, plus
  `UI_PASSWORD`, and they drive the `demo` project, cleaning up what they make. A spec that fails
  mid-test leaves its files in `demo`, and the next run then fails on a `409` that has nothing to do
  with the code: clear `zz-*` out of `D:/work/clodeck-projects/demo` before believing a red run.
- **A docs-only or handoff-only change is not exempt from branching** — this file travelled on
  `docs/handoff-75-76`, exactly as `AGENTS.md` says. Merging is still `--no-ff` and still the user's
  call — this time they asked for the handoff and the push in one breath.

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
project root, **a project can be created from the UI**, **per-session provider profiles** (66, with
endpoint and credential travelling together), and **the composer's `/` menu** (75) — the session's own
commands, never clodeck's own buttons.
