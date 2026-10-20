# Handoff — clodeck: four of six reports fixed; permission modes and project deletion decided, both builds queued

**Updated:** 2026-10-21
**Where the tree is:** `main`, clean, carrying both merges of this phase — the permission-mode contract,
ADR 0003 and tickets 82–86 (`ba496f6`), then the project-delete decision, `spec-10` and tickets 88–91
(`2f72d1d`). Both branches were deleted after their merge. One branch is deliberately **left unmerged**:
- `clodeck/file-panel-mobile-prototype` (`adb9f41`) — the throwaway prototype behind ticket 80. It is
  the primary source for the comparison and is **never** merged; delete it when it stops being useful.

**Tests on the merged tree:** `npm run typecheck` clean; `npm test` green — tooling **25**,
shared **10**, server **385** passed + 9 skipped, web **281** (30 files); the whole dev-pair
e2e suite **7/7** on `main` itself.

## The six reports, and where each stands

| # | Report | State | Where it lives |
|---|---|---|---|
| 1 | On a phone the nav sat under Chrome's address bar | **fixed** | shell is `h-dvh`; merge `893ad47` |
| 2 | Mobile file manager: the 300px tree never closes, so the file is unreadable | **fixed** | file width + browse sheet below `md`; merge `233502e`; decision in `issues/80-mobile-file-drawer-decision.md` |
| 3 | A folder nested in a folder could not be dragged to the root | **fixed** | every row draggable; merge `021456f` |
| 4 | Permission modes (ask / accept edits / plan / bypass) missing in chat | **decided — build queued as 82–86** | decision 81 + ADR 0003; protocol has `set_permission_mode`; still no UI |
| 5 | A project cannot be deleted | **decided — build queued as 88–91** | decision 87 + `spec-10`; still no `DELETE /api/projects/:id` |
| 6 | clodeck looked more expensive than the CLI | **researched + two fixes** | note + auto-resume + token display; merges `943f3d2`, `5179415` |

## What landed (do not re-investigate)

### 1. Mobile viewport

`h-screen` on the shell resolves to `100vh`, which on mobile Chrome is the **largest** viewport — the
one with the browser toolbar retracted. The bottom nav was laid out below the visible edge. The shell
is now `h-dvh` (`web/src/App.tsx`), and `App.workspace.test.tsx` pins the class. **A Playwright test
cannot catch this**: emulation makes `100vh` and `100dvh` the same number, which is why the check is a
class assertion rather than a bounding box.

### 2. Mobile file drawer

The old panel was two columns at every width — a fixed `w-[300px]` tree and a `flex-1` code column — and
the phone's drawer is a full-screen sheet, so at 360px the file got ~60px. The tree column is now a
**slide-over sheet below `md`**: the file takes the width, a `Browse` bar summons the list, and a file
pick, the sheet's ✕, or the scrim dismisses it. `md:` classes put the old column back, so there is one
copy of the tree and the move/upload/drag wiring is not duplicated.

Two findings, both load-bearing:
- **A missing `min-w-0` on a flex wrapper** let a long line stretch the pane to content width — the code
  head measured 809px at 360px, and the `read-only` chip landed off screen. That was the prototype's
  first bug (`adb9f41`), and the reason the e2e now asserts the head is exactly 360 wide. It was not the
  256 KiB `truncated` rule; that chip is deliberately unclickable.
- **The scrim sits inside the code column**, not as a third child of the `section`: "two direct children"
  is the layout contract `FilePanel.test.tsx` asserts.

The shape was chosen with `?variant=A|B|C` in `web/src/files/mobilePrototype.tsx` on
`clodeck/file-panel-mobile-prototype` (throwaway, **not** merged) — A drill-down replaced the list with
the file, B stacked both panes with a divider; the user picked **C**, and the full verdict is in
`issues/80-mobile-file-drawer-decision.md`.

### 3. Folder drag-to-move

Only a **file** row was `draggable`; a folder row was only a drop target. Every row is now draggable,
and a folder row is both. A drop on the folder itself or on a folder inside it is **swallowed**
(`insideDragged`) rather than allowed to bubble to the tree's root area, where it would have silently
meant "move to root". Tests: `web/src/files/FilePanel.test.tsx`, `describe('dragging a folder')`.

### 6. Token cost — the ranking that answers the report

Full note: `.scratch/clodeck/research/01-token-cost.md` (merged).

1. **The `$` clodeck showed was a Claude-priced estimate, not a bill** (VERIFIED). The SDK prices an
   unknown model at the default model's rate — Opus 5.5 — and `deepseek-flash[1m]` /
   `deepseek-v4-pro[1m]` match no row. The recorded estimates reproduce Opus list rates exactly and
   are **9–82×** the real DeepSeek bill.
2. **The two paths may not run the same model or endpoint** (env difference VERIFIED; which one clodeck
   inherited is HYPOTHESIS). User env: `auto/best-free` + `localhost:20128`; process/sandcastle:
   `deepseek-flash[1m]` + `api.deepseek.com/anthropic`. The server log line
   `turn on profile … · model … · sent: …` is the answer for a given run.
3. **Every send used to start a fresh SDK session** (VERIFIED). No auto-resume, so a follow-up lost
   the context and re-explored it, and a resumed result's cost was cumulative without a label.

**What changed:**
- `server/src/ws/turn-manager.ts` — a send with no armed target now **resumes `state.sessionId`**.
  An explicit History/Resume target still wins; `clear_resume` (`New chat`) drops the session id, so
  a new chat is still fresh.
- The result line shows **`modelUsage` token totals**, not `total_cost_usd`:
  `Turn complete · session 61,081 in · 303,360 cached · 6,851 out`, with a per-model tooltip.
- The server logs, per result:
  `session tokens · <model> in … · cache read … · cache write … · out …`.

**The one number to remember:** `modelUsage` is **cumulative for the session** (the SDK's own docs say
a resumed session's first result already carries earlier turns), which is why the UI and the log say
`session`. A per-turn delta is a separate change, not a bug in this one.

## What remains

### A. Permission modes — decided (ticket 81); the build is tickets 82–86

**Decided 2026-10-21.** The four-mode contract — **Ask**, **Accept edits**, **Plan**, **Bypass** — is
in `.scratch/clodeck/issues/81-permission-modes-decision.md`; the rule it rests on is
`docs/adr/0003-permission-modes-are-a-contract-not-an-sdk-passthrough.md`.

**In one paragraph:** the session (the run), not the project, owns the mode; the default comes from
`CLODECK_PERMISSION_MODE`; the mode is stored in `ProjectRun` and passed to every `query()`. Ask and
Accept edits force **every** Bash call to the approval callback (read-only and filesystem commands
included); Plan **denies** edits and Bash without prompting; a project's settings can tighten a mode
but never loosen it; `auto` and `dontAsk` are refused at the wire.

**What is still missing (the build):**
- `SendPromptPayload` (`shared/src/protocol.ts:113`) still carries only `{ prompt, profile }` — the
  first send cannot name a mode (82).
- `ProjectRun` has no mode, so every turn falls back to `'default'` (82).
- `web/src` has no mode control at all (82).
- `bypassPermissions` still lacks `allowDangerouslySkipPermissions: true` (83).

**Next:** the tickets are on `main` — 82 (composer picks the mode), 83 (every Bash call asks), 84 (plan
denies without prompting), 85 (bypass with gates), 86 (operator docs). `spec-09-permission-modes.md` was
never written: ticket 81 stands in for it, and the tickets were split straight from the decision. Write
the spec only if the build turns out to need the collapse; do not treat its absence as a blocker.

Tests to aim at: a bus test that `send_prompt` carries the mode and the *next* send keeps it; a web
picker test; an approval path that proves Ask still parks a Bash call and Bypass does not.

### B. Delete a project — decided (ticket 87); the build is tickets 88–91

**Decided 2026-10-21.** The whole decision is `.scratch/clodeck/issues/87-delete-project-decision.md`;
ten calls, in one paragraph:

- **A real delete.** `DELETE /api/projects/:id` removes the project directory recursively — no trash,
  no hide-via-registry (there is no registry, and ticket 46 says the filesystem is the truth).
- **The SDK transcripts stay.** Deleting the directory does not touch `~/.claude/projects/<path>/`; a
  purge would have to reach outside the allowlist, which is the one place allowed to destroy data.
- **`409` while busy**, and not on `runningSession(projectId)` — that misses a run that has not named a
  session yet. Check the run's `active`/status and `terminals.has(projectId)`. Stop-then-delete was
  rejected: `terminals.close()` leaves the owning WebSocket holding a dead terminal.
- **Typed-name confirmation**, exact and case-sensitive, with the canonical path shown — the only
  whole-working-tree destruction in the app, beside other rows in a narrow sidebar.
- **Hover `⋯` row menu → `Delete…`** in `ProjectSwitcher`; rename stays deferred (ticket 47, call 4).
- **A symlink entry is refused** (`400 symlink`): discovery dedups by canonical path, so a link can be
  the visible row for another entry's id. Deletable only when exactly one root entry canonicalizes to
  the id and it is a real directory.
- **Codes:** `204` / `404` / `409 turn_in_progress` / `409 terminal_attached` / `400 symlink`.
- **After:** reload, `deleted <name>` toast, and if it was selected, clear to the no-project empty state
  rather than jumping to a neighbour.
- **Forget the `ProjectRun` entry**: ids are canonical paths, so delete + re-create yields the same id,
  and the stale entry's `sessionId` would silently auto-resume a deleted project's conversation.
- **History may still show the old sessions** after a re-create (the transcripts were kept); Resume is
  explicit, never automatic.

Build: `deleteProject` on the `ProjectDiscovery` seam (never `ScopedFs.remove`, which is project-scoped
and would unlink a symlink), the route in `server/src/projects.ts` mapping to the codes above, the typed
dialog as an extension of `NameDialog`, and tests for the route, the seam's symlink refusal, the run
forget, and the sidebar's refusal paths.

**Queued:** `spec-10-project-delete.md` is the slice, and the tickets are **88** (the typed-name dialog —
the prefactor), **89** (the route, the seam, the refusals and the forget), **90** (the sidebar flow,
blocked by 88 and 89), **91** (operator docs, blocked by 89 and 90). 88 and 89 are independent and can
run in parallel.

## Next-session prompt (paste this)

```text
do saf-e ticket rooy-e main hastan va hich kari az decision-hā moonde nist:

1) permission modes (82-86): decision-e 81 + ADR 0003 + ticket-ha rooy-e main hastan vali hich
   kodi neveshte nashode. /implement rooy-e 82 (composer mode) ke frontier-e ready ast; 83/84/85/86
   ham be tartib. spec-09 neveshte nashode — ticket 81 jāyash rā migirad, blocker nist.

2) delete project (88-91): spec-10 + decision-e 87 rooy-e main. 88 (typed dialog) va 89 (route +
   seam + 409-ha + forget) mostaghelan ready-and; 90 (sidebar) blocked by 88+89; 91 (docs) blocked
   by 89+90.

tavajjoh: branch-e prototype (clodeck/file-panel-mobile-prototype) amdan unmerged moonde va
hichvaght merge nemishavad (throwaway, faghat primary source ast).

handoff: .scratch/clodeck/handoff.md — ghabl az shoroo, git log --oneline -8 ra check kon va
agar shakhe avaz shode bood, avval vaziat ra befahm.
```

## Dev loop (unchanged, still load-bearing)

Port **3001 is unbindable on this machine** (Windows Hyper-V/WSL exclusion range). Run with `PORT=3300`,
and give `PROJECTS_ROOT` **forward slashes** — Git Bash eats backslashes in an env assignment, and the
server then scans the wrong directory and discovers nothing.

```cmd
set UI_PASSWORD=dev
set PROJECTS_ROOT=D:/work/clodeck-projects   rem  backslashes are mangled under Git Bash
set PORT=3300
npm run dev          rem -> http://localhost:5173   (npm run dev:fake if there is no API key)
```

## Guardrails (do not lose these)

- **Branch first.** Every change — code, docs, tickets, handoff — goes on its own branch and lands on
  `main` only by an explicit `--no-ff` merge. No ticket → effort name plus a short slug; docs-only →
  `docs/` prefix. Stop at the merge unless the user asks.
- **The pre-commit hook** (`.githooks/pre-commit`) runs `npm run typecheck` and `npm test`. There is no
  CI; a red tree cannot be committed. `--no-verify` only if the user asks.
- **Eight browser specs** under `web/e2e/` (project-switch, file-upload, file-download, file-move,
  code-view, command-menu, direct-route, responsive-layout). They need a running dev pair on an
  **isolated** port (do not assume 5173/3001 is yours — the user may have their own loop there), plus
  `UI_PASSWORD`. A failed spec can leave `zz-*` files in `demo` and poison the next run.
- **The checkout can move under you.** Another session or the sandcastle loop may switch branches
  mid-work; verify `git rev-parse --abbrev-ref HEAD` before writing or asserting state.
- **`npm run sandcastle`** drains tickets one per branch. The queue is on `main`: 82–86 (permission
  modes) and 88–89 (delete), with 90 and 91 unblocking as their blockers resolve. Every one of them is
  `ready-for-agent` in the tracker's own reading — check with `node scripts/tickets.mjs list --brief`.

## Still load-bearing (updated this phase)

- **Auto-resume:** a send continues `state.sessionId` unless an armed target exists; `clear_resume`
  drops both the transcript and the id. `New chat` therefore still starts a real new session.
- **Result usage:** the UI shows session token totals from `modelUsage`, never `total_cost_usd`; the
  server logs the same per model. The dollar field is still on the wire (the SDK sends it) and is
  documented as a Claude-list-rate guess.
- **Below `md` the file drawer is the file, with the tree as a browse sheet.** The sheet starts open and
  a file pick, its ✕, or the scrim shuts it; `Browse` brings it back. Above `md` the `md:` classes put the
  fixed 300px column back — one tree element, not two. The sheet's wrapper must keep `min-w-0`, or a long
  line stretches the head and hides the edit chip (issue 80).
- **Every file row is draggable**, and a folder row is also a drop target; self/descendant drops are
  swallowed. The drag carries `text/plain` only — an OS-file drag carries `Files` and is the upload.
- **A project is created by `POST /api/projects { name }`**, on the discovery seam, never by `ScopedFs`
  and never overwriting anything.
- **File access stays inside the project root:** `realpath` containment, no symlink writes, no
  overwrite on create/upload/move, and the root itself is never a write target.

## Known loose ends

- **`modelUsage` is cumulative**, so the result line grows across a resumed chat. A per-turn delta (or
  a provider-priced dollar figure) is a separate decision.
- **Cause #1 of the cost note is unconfirmed for a specific run**: check the server's
  `turn on profile …` line and compare with `claude -p … --output-format json` → `modelUsage`.
- **The direct-route e2e spec was not run** (it needs the built client served at the LAN origin and a
  provider credential). The dev-pair suite is 7/7 on `main`; that part of the gap is closed.
- **The mobile viewport fix has no browser test that can fail** — keep the class assertion, and do not
  spend time trying to emulate a retracting Chrome toolbar.
