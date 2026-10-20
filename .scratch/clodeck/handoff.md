# Handoff — clodeck: four of six reports fixed; permission modes and project deletion remain

**Updated:** 2026-10-20
**Where the tree is:** `main`, clean, carrying this phase's work — the file drawer fix merged `--no-ff`
(`233502e`) and the decision + this handoff merged `--no-ff` (`b3944c6`). Both branches were deleted
after their merge. One branch is deliberately **left unmerged**:
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
| 4 | Permission modes (ask / accept edits / plan / bypass) missing in chat | **open — next** | protocol has `set_permission_mode`; no UI |
| 5 | A project cannot be deleted | **open** | no `DELETE /api/projects/:id` |
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

### A. Permission modes (decision, then build)

**What exists:** `PermissionMode` already has all six SDK values (`shared/src/sdk.ts:26`); the wire
has `set_permission_mode` (`shared/src/protocol.ts:152`), handled at `server/src/ws/bus.ts:133`; the
run passes `permissionMode: input.permissionMode ?? 'default'` (`server/src/sdk/anthropic.ts:108`).

**What is missing:**
- `turn-manager.ts:202` refuses `set_permission_mode` unless a turn is **already running**
  (`no_active_turn`). A mode chosen before the first send has nowhere to go: `SendPromptPayload`
  (`shared/src/protocol.ts:113`) carries only `{ prompt, profile }`.
- `web/src` has **no mode control at all** (grep `permission` finds only the approval dialog).
- `bypassPermissions` needs `allowDangerouslySkipPermissions: true` in the SDK `Options`
  (`sdk.d.ts:1994`) — not set today. `auto` and `dontAsk` are in the union but have never been
  exercised by clodeck.

**Decisions to grill, not guess:** scope (per chat/session, per project, or both), which of the six to
expose, what a mid-turn switch means, whether the choice survives a reconnect or a `New chat`, where
the control sits (the composer line already holds the provider picker), and what the bypass warning
says. Then a decision ticket under `.scratch/clodeck/issues/`, then `/tdd`.

Tests to aim at: a bus test that `send_prompt` carries the mode and the *next* send keeps it; a web
picker test; an approval path that proves `default` still parks and `bypassPermissions` does not.

### B. Delete a project (decision, then build)

Only `GET /projects` and `POST /projects` are registered (`server/src/projects.ts:20-27`). Projects
are immediate child directories of `PROJECTS_ROOT`, with **no registry**, and `ProjectDiscovery`
(`server/src/discovery.ts:19`) is the only module allowed to touch the root.

**Decide the semantics first:**
- truly delete the directory recursively (irreversible), or
- move it to a trash directory, or
- hide it from the list (a registry — conflicts with the standing "no registry" decision).

If it deletes, the safety shape matters: typed confirmation of the project name; resolve the id
through the allowlist (never trust the decode); refuse the root itself; refuse while a turn is live
(`runningSession(projectId)` exists) or a terminal is attached; and decide what happens to the SDK
session JSONL under `~/.claude/projects`, which deleting the directory does **not** remove.

Then: `DELETE /api/projects/:id` on the gated scope → `204` / `404` / `409`, `deleteProject` on the
discovery seam, sidebar confirm + reload + clear selection. Tests: route tests against a sandbox root,
and the sidebar's refusal paths.

## Next-session prompt (paste this)

```text
دو کار از لیست مونده، به همین ترتیب:

1) permission modes: backend فقط وسط turn با set_permission_mode کار می‌کند و UI ندارد.
   با /grilling تصمیم بگیر: scope (per chat/session یا per project)، کدام modeها،
   persistence بعد از reconnect/New chat، و allowDangerouslySkipPermissions برای
   bypassPermissions. بعد decision ticket و /tdd.

2) delete project: route ندارد. اول semantics (delete روی disk vs trash vs hide) و safety
   (typed confirm، refuse root، refuse وقتی turn/terminal زنده است، session JSONLها) را
   تصمیم بگیر، بعد route + sidebar UI.

توجه: file drawer merge شده (233502e) و روی main است؛ branch-e prototype
(clodeck/file-panel-mobile-prototype) عمداً unmerged مانده و هیچ‌وقت merge نمی‌شود
(throwaway، فقط primary source است).

handoff: .scratch/clodeck/handoff.md — قبل از شروع، git log --oneline -8 را چک کن و
اگر شاخه عوض شده بود، اول وضعیت را بفهم.
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
- **`npm run sandcastle`** drains tickets one per branch. No tickets are queued right now; the two
  remaining reports are decisions, not agent-ready tickets yet.

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
