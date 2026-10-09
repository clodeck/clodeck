# Handoff — web-claude-ui

**Updated:** 2026-10-09
**Effort map:** [map.md](map.md) — read this first; it is the canonical state.
**This file:** the *session-to-session* layer. It holds what the map, the tickets,
and the code don't. It is committed on purpose, so a session on another machine
can pick the work up. Overwrite it each time; git history keeps the old ones.

## Where this stands

Ticket [04 — Backend transport and API shape](issues/04-backend-transport.md) is
**resolved**: WebSocket (JSON, one multiplexed bus per browser session) for
chat/tool events (SSE rejected), a thin normalized envelope (passthrough SDK
payload), REST for CRUD/mutations, one active turn per project, keep-running +
buffer + 60s reattach. The verdict and the full event/endpoint shape are recorded
in the ticket's `## Answer`; `map.md` carries the one-line summary.

[05 — Project discovery](issues/05-project-discovery.md) is **resolved**:
single-root filesystem scan, immediate children = projects, `id` =
base64url(canonical path), on-demand rescan, keep-running + hide on removal,
the root as the allowlist (enforced everywhere), plus a deliberate multi-user
seam (modular discovery/allowlist; the reversible id is an identifier, never a
credential). Full verdict in the ticket's `## Answer`; `map.md` carries the
one-line summary.
Model selection and live file editing are confirmed **out of MVP** (map
"Out of scope" + `AGENTS.md`).

## What the next session is for

1. Open and run the next ticket — **session↔project data model & persistence**
   (resume-by-id, where session state lives; map "Not yet specified"). It is the
   remaining data-model gap and is now unblocked: the SDK research (01) and the
   project model (05) are both settled. (Number it 06 if nothing is drafted yet.)
2. **One ticket per session** — do not start anything past that.

## Facts that live nowhere else

1. **The prototype is verified, not just rendered.** It is driven through
   headless Chrome over CDP and fails on any console error. **Re-run it with
   `node prototype/verify.mjs`** (Node 22+, no dependencies). The file-tree
   matchers select by `.tree-row .name`, not by the row's whole text — the
   drawer now appends a size to each file row, so a naive `textContent` match
   would miss. It also drives the read-only⇄edit toggle and the row ⋯ menu →
   confirm modal (delete-cancel), so a broken modal is caught here.
2. **Variant A's file drawer is the spec surface now.** Toolbar = upload
   (drag-and-drop, 200 MB cap) / new file / new folder / refresh / tree⇄list
   toggle; per-row ⋯ menu = rename (inline prompt) + delete (confirm modal);
   drag a file onto a folder + confirm = move; viewer header = download (real
   Blob) + markdown preview (Preview⇄Source) + read-only⇄editable toggle +
   metadata (size · modified · permissions). All still mock: metadata is derived
   in `common.js` (`fileMeta`), and create/rename/delete/move/edit mutate the
   in-memory tree, never disk.
3. **The product name is still a placeholder** ("deck (placeholder name)"). That
   naming decision is fog, not a ticket — don't ticket it until it's sharp.
4. **There is no git remote.** `git remote -v` is empty, so "work from another
   machine" currently means copying the folder. Adding a remote is an open,
   untracked decision — see below.
5. **Prototype structure:** variants share *widgets* (chat, terminal, file tree,
   code view in `common.js`) on purpose, so the comparison stays about structure;
   they share no *layout*. The file-drawer additions are opt-in via
   `FileTree({ toolbar: true })` — B and C do not pass it and are unchanged.

## Open, not yet on the map

- **A git remote.** Until one exists, this repo cannot move between machines and
  nothing can be pushed. It is not a wayfinder ticket and probably doesn't
  deserve to be one — it's a one-line setup decision the user owns.
- **The product name** (see fact 3).

## Resume

```
/wayfinder .scratch/web-claude-ui/map.md   +  "ticket 06 — session data model & persistence"
```
