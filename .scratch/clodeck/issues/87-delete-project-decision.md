# 87: A project can be deleted — a real delete, and the safety that pays for it

**What to build:** Nothing runnable. This is the decision ticket: record that **a project can be removed
from the UI**, fix what "delete" means (a real recursive delete — no trash, no hide), fix the safety
shape that makes an irreversible action acceptable in a narrow sidebar, and settle the two side effects
the directory does not own: the live run, and the SDK session history. It is ticket 46's pattern —
decisions in one place, first, so the build argues with none of them.

**Blocked by:** none

**Status:** resolved — the user chose every item below on 2026-10-21, in a grilling session; the docs
moves land in this ticket's branch. `/to-spec` then writes `spec-10-project-delete.md` and `/to-tickets`
splits the build.

## The problem

The sidebar can list projects (`GET /projects`) and add one (`POST /projects`) and nothing else: those
are the only two routes (`server/src/projects.ts:20-28`). A project created by mistake, or one whose
work is finished, can only be removed with a shell — which is the exact thing this product exists to not
require. It is report 5 of the six in `handoff.md`, and the only one still undecided.

Everything the decision has to respect is already in place:

- A project is one immediate child directory of `PROJECTS_ROOT`, the root is the allowlist, and `id` is
  `base64url` of the canonical path (`server/src/discovery.ts:69-72`, :130). There is no registry.
- `ProjectDiscovery` is the only module allowed to touch the root (`server/src/discovery.ts:19`); a delete
  is a **root-level** operation, so it belongs on that seam beside `createProject`, never on `ScopedFs`
  (whose own root is by design never a write target).
- Deleting a directory does **not** touch the SDK's transcripts under `~/.claude/projects`. clodeck never
  computes that path itself — sessions are listed and deleted through the provider seam
  (`server/src/sdk/anthropic.ts:59-79`).
- The nearest precedent is session delete: `DELETE /projects/:id/sessions/:sid`, hard delete, `204`, and
  `409 turn_in_progress` when that session is the running one (`server/src/sessions.ts:55-80`).

## The decision

Ten calls. Each one was put to the user and answered; the "why" is what the build must not undo.

**D1 — A delete is a real delete.** The project directory is removed recursively. No trash directory, no
hide-via-registry. Hide needs a registry and the standing decision (ticket 46, call 5) says the filesystem
is the single source of truth; a `.trash/` inside the root is reachable without a registry, but it buys a
second lifecycle — retention, restore UI, emptying — that a single-user deployment with shell and backup
access does not need. Safety is spent on the confirmation instead, where it costs nothing when unused.

**D2 — The SDK transcripts are left exactly where they are.** Deleting the directory leaves
`~/.claude/projects/<sanitized-path>/` behind as an orphan. We do not purge it, even though the provider
seam could (`listSessions(dir)` → `deleteSession(id, dir)`, `server/src/sdk/anthropic.ts:59-79`), for
three reasons: the purge would have to run *before* the directory disappears, it is a loop that can fail
half way and leave a half-purging history, and it would make delete reach outside the allowlist — the one
place in clodeck that is allowed to destroy data. The orphancy is documented for the operator. A later
"purge sessions of a deleted project" command is possible; it is not this ticket.

**D3 — A live run or an attached terminal refuses the delete, with `409`.** clodeck does not stop things
on the user's behalf: they press stop, then delete. The busy check is **not** `runningSession(projectId)`
(`server/src/ws/turn-manager.ts:228-235`) — that returns `undefined` for a run that has started but not
yet named a session, so it protects nothing. The check is the run's own state: an entry whose `active` is
set / whose `status` is not `idle` (`server/src/ws/turn-manager.ts:451-457` is the only place it is
cleared). Terminal attachment is `terminals.has(projectId)` (`server/src/terminal/manager.ts:117-119`).
Stop-then-delete was rejected because `terminals.close()` kills the pty without firing `onExit` and
without closing the owning WebSocket (`server/src/terminal/manager.ts:56-63`; the owner map is private to
the transport), so the UI would be left holding a dead terminal.

**D4 — The confirmation is the typed project name.** The user types the name exactly — case-sensitive,
no trimming beyond what the field itself does — and only then does the button enable. This is the only
place in clodeck that destroys a whole working tree with no undo, and the button sits beside other rows
in a narrow sidebar. No such primitive exists today: `ConfirmDialog` names what is removed
(`web/src/files/FilePanel.tsx:1815-1853`), `DeleteSessionDialog` names what is lost
(`web/src/chat/SessionHistory.tsx:177-215`), and `NameDialog` validates a name but does not compare it to
an existing one (`web/src/dialogs.tsx:29-96`) — the typed-name dialog is a small extension of that last
one. The dialog also shows the **canonical path**, so the user sees exactly what leaves the disk.

**D5 — The affordance is a hover `⋯` row menu with `Delete…`.** `ProjectSwitcher` has no row menu today
(`web/src/ProjectSwitcher.tsx:95-115`), and the header already holds `New project` and `Refresh`. A hover
menu matches the file drawer's rows, cannot be hit by accident while selecting, and leaves room for the
rename that ticket 47 explicitly deferred. Rename itself stays out of scope (ticket 47, call 4).

**D6 — A project reached through a symlink is refused, `400 symlink`.** Discovery lists symlinks
(`server/src/discovery.ts:139-166`) and dedups by canonical path, so a link `alpha` → `zulu` can be the
row shown for `zulu`'s id. Deleting by id would then destroy `zulu` while the label said `alpha`; unlinking
the link would leave every file in place and make the delete a lie. The rule the build must implement:
the id is deletable only when **exactly one** root entry canonicalizes to it **and** that entry is a real
directory (`lstat`, not a symlink). Anything else is refused. The code is the file routes' own symlink
code, `400`, from `writeOutcome` (`server/src/files/transport.ts:374-387`).

**D7 — The route and its codes.**

| Call | Status | Body |
|---|---|---|
| `DELETE /api/projects/:id` in the gated `/api` scope (`server/src/app.ts:123-148`) | `204` | none |
| id that does not resolve through the allowlist | `404` | `{ error: 'not found' }` |
| a run is live | `409` | `{ error: 'turn_in_progress' }` |
| a terminal is attached | `409` | `{ error: 'terminal_attached' }` |
| the entry is a symlink, or the path is ambiguous | `400` | `{ error: 'symlink' }` |

The root itself needs no arm of its own: it is not an immediate child, so `resolveProject` never returns
it (`404`). `turn_in_progress` reuses the session delete's code word, so one word means one thing in the
API.

**D8 — After a successful delete.** The list reloads (as `create` already does, `web/src/App.tsx:54-60`);
the sidebar shows a `deleted <name>` toast, symmetric with `created <name>`; and if the deleted project was
the selected one, selection clears to the existing no-project empty state rather than jumping to a
neighbour — picking the next project for the user would be a choice, not a convenience. On a refusal the
dialog stays open and shows the server's error, the pattern both existing delete dialogs already follow.

**D9 — The delete forgets the project's run state.** `TurnManager` keys `ProjectRun` by `projectId` and
leaves the entry in place after a turn ends (`server/src/ws/turn-manager.ts:85-106`). Because the id is
the canonical path, deleting `foo` and creating `foo` again yields the **same** id and the **same** stale
entry — whose `sessionId` auto-resume would silently continue (`server/src/ws/turn-manager.ts`), on the
old profile and mode. A row that was just created must not secretly be a continuation of a deleted
project, so the delete drops that entry.

**D10 — Re-creating a project may still see the old history, but only by asking.** Since D2 keeps the
transcripts and the SDK derives its directory from the path, a re-created `foo` has the old sessions in
`History`. That is allowed and is arguably the only undo this feature has; what D9 forbids is the
*implicit* resume. Resume stays a button the user presses.

## What this decision does not cover

- **Rename** — ticket 47, call 4, still deferred.
- **Trash / undelete / retention** — refused above; revisiting it is a new decision, and the shape that
  would make it cheap (a `.trash/` dot-directory the scan already skips) is named here so it is not
  rediscovered.
- **Purging SDK transcripts** — D2; a maintenance command if it ever matters.
- **Deleting the current project's files from the drawer** — already exists; the drawer deletes *inside*
  a project, this deletes the project.
- **Multi-user** — a delete names an actor question the discovery seam was written to absorb later, not one
  this ticket answers.

## Why no ADR

The three ADR tests fail or are already met elsewhere: the *code* is trivially reversible, and what is
irreversible is the destruction the feature is for; a future reader's "why no trash?" is answered by the
no-registry decision that already exists (ticket 46) plus ticket 79's hard-delete precedent for sessions.
No new rule is being minted here — the rule is "project operations live on the discovery seam and the
filesystem is the truth", which is already the repo's.

## What the build has to satisfy

**Seam.** `ProjectDiscovery` gains a `deleteProject(id)` returning its own result union (ok / not_found /
symlink / busy is *not* a discovery concern — the route checks the run and the terminal first, then calls
it). Discovery is still the only module that touches the root, and it still never treats the root itself
as a target. `ScopedFs.remove` (`server/src/files/scoped-fs.ts:340-349`) is **not** reused: it is
project-scoped by construction, and it would tolerate a symlink by unlinking it.

**Route.** `DELETE /api/projects/:id` beside the other two in `server/src/projects.ts`, on the gated scope,
mapping the union to D7's codes. It is not audited or logged beyond what the other project routes do.

**Web.** Row menu → typed-name dialog (name + canonical path + the irreversible warning) → `DELETE` →
reload + toast + selection clear; the dialog holds on error.

**Tests to aim at.**
- Route: `204` removes a sandbox project directory; `404` for an unresolvable id; `409 turn_in_progress`
  and `409 terminal_attached` with the reason; `400 symlink` for a link entry; the root's own path is a
  `404`.
- Discovery: the symlink/ambiguity refusal is decided by the scan, not by the decode; `deleteProject`
  never removes the root.
- Turn manager: after the delete the entry is gone, so a re-created project's first send carries no
  `sessionId`.
- Web: the dialog's confirm stays disabled until the exact name is typed; a refusal keeps it open with the
  server's message; a success clears the selection.

## Docs moves (this ticket's branch)

- [x] `AGENTS.md` — the project standing-decision bullet gains the delete clause (the filesystem stop
      being the only door, in both directions), and the MVP scope bullet names deleting a project as
      brought in by this decision.
- [x] `.scratch/clodeck/handoff.md` — report 5's row and section "B. Delete a project" move from *open* /
      *decide the semantics first* to *decided, build pending*, pointing here.
- [ ] `spec.md` / `spec-10-project-delete.md` — `/to-spec`, not this ticket.
