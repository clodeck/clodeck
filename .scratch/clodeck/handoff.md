# Handoff — clodeck: three of six reports fixed; the rest need decisions first

**Updated:** 2026-10-20
**Where the tree is:** `main`, clean, **local only — not pushed** (8 commits ahead of
`origin/main`; the last is `5179415`). Every branch this phase used was merged `--no-ff` and deleted.
**Tests on the merged tree:** `npm run typecheck` clean; `npm test` green — tooling **25**,
shared **10**, server **385** passed + 9 skipped, web **281** (30 files).

## The six reports, and where each stands

| # | Report | State | Where it lives |
|---|---|---|---|
| 1 | On a phone the nav sat under Chrome's address bar | **fixed** | shell is `h-dvh`; merge `893ad47` |
| 2 | Mobile file manager: the 300px tree never closes, so the file is unreadable | **open — next** | `web/src/files/FilePanel.tsx:295` |
| 3 | A folder nested in a folder could not be dragged to the root | **fixed** | every row draggable; merge `021456f` |
| 4 | Permission modes (ask / accept edits / plan / bypass) missing in chat | **open** | protocol has `set_permission_mode`; no UI |
| 5 | A project cannot be deleted | **open** | no `DELETE /api/projects/:id` |
| 6 | clodeck looked more expensive than the CLI | **researched + two fixes** | note + auto-resume + token display; merges `943f3d2`, `5179415` |

## What landed (do not re-investigate)

### 1. Mobile viewport

`h-screen` on the shell resolves to `100vh`, which on mobile Chrome is the **largest** viewport — the
one with the browser toolbar retracted. The bottom nav was laid out below the visible edge. The shell
is now `h-dvh` (`web/src/App.tsx`), and `App.workspace.test.tsx` pins the class. **A Playwright test
cannot catch this**: emulation makes `100vh` and `100dvh` the same number, which is why the check is a
class assertion rather than a bounding box.

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

### A. Mobile file manager (next; shape first)

`FilePanel.tsx:295` is a fixed `w-[300px]` tree column beside a `flex-1 min-w-0` code column. At the
360px floor the content column gets ~60px, which is exactly the report. The drawer itself is already a
full-screen sheet on a phone (`App.tsx`), so the split is *inside* the sheet.

**Decide the shape before coding** — this is a UI question a prototype answers faster than prose:
- **drill-down:** selecting a file hides the list; a Back control returns to it; or
- **stacked panes:** list on top / file below, with a resize or a toggle.

`/prototype` is the right first move. Then implement, and extend `web/e2e/responsive-layout.spec.ts`
with the file-panel case: at 360px, after selecting a file, the content is readable (the tree is not
still taking 300px), there is no horizontal scroll, and Back returns to the list.

### B. Permission modes (decision, then build)

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

### C. Delete a project (decision, then build)

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
سه کار از لیست قبلی مونده، به همین ترتیب:

1) file manager روی موبایل: FilePanel دو ستونه است (tree ثابت 300px + content) و روی 360px
   محتوای فایل خوانا/قابل ویرایش نیست. اول با /prototype شکل موبایل را انتخاب کن
   (drill-down با Back یا stacked panes)، بعد پیاده‌سازی + تست موبایل در
   web/e2e/responsive-layout.spec.ts.

2) permission modes: backend فقط وسط turn با set_permission_mode کار می‌کند و UI ندارد.
   با /grilling تصمیم بگیر: scope (per chat/session یا per project)، کدام modeها،
   persistence بعد از reconnect/New chat، و allowDangerouslySkipPermissions برای
   bypassPermissions. بعد decision ticket و /tdd.

3) delete project: route ندارد. اول semantics (delete روی disk vs trash vs hide) و safety
   (typed confirm، refuse root، refuse وقتی turn/terminal زنده است، session JSONLها) را
   تصمیم بگیر، بعد route + sidebar UI.

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
- **`npm run sandcastle`** drains tickets one per branch. No tickets are queued right now; the three
  remaining reports are decisions, not agent-ready tickets yet.

## Still load-bearing (updated this phase)

- **Auto-resume:** a send continues `state.sessionId` unless an armed target exists; `clear_resume`
  drops both the transcript and the id. `New chat` therefore still starts a real new session.
- **Result usage:** the UI shows session token totals from `modelUsage`, never `total_cost_usd`; the
  server logs the same per model. The dollar field is still on the wire (the SDK sends it) and is
  documented as a Claude-list-rate guess.
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
- **`npm run e2e` has not been run against this phase's merged tree.** The unit suites cover each
  change; the browser check of the combination is the gap.
- **The mobile viewport fix has no browser test that can fail** — keep the class assertion, and do not
  spend time trying to emulate a retracting Chrome toolbar.
