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

[06 — Session ↔ Project data model & persistence](issues/06-session-project-data-model.md)
is **resolved**: the SDK transcript store is the single source of truth (no
server session DB), session = SDK `session_id` / turn = 04's `turnId`, default-fresh
+ explicit resume, history normalized to the live renderer shape, empty chats are
client state (no row until first send), `~/.claude` as a Docker volume, `sessionStore`
as the future seam. Full verdict in the ticket's `## Answer`; `map.md` carries the
one-line summary.

[07 — Auth & Permissions](issues/07-auth-permissions.md) is **resolved**:
single-account login over HTTPS via an httpOnly session cookie (`SameSite=Strict`
+ origin check; WS auth rides the cookie), in-memory server-side session store
behind an interface, password-only (`UI_PASSWORD`/`UI_PASSWORD_FILE`, bcrypt/argon2
hash, timing-safe), TLS at a reverse proxy (Caddy) with direct-TLS fallback,
principal-aware middleware (`"default"` principal = the multi-user seam), everything
gated, per-IP login rate-limit + lockout. Full verdict in the ticket's `## Answer`;
`map.md` carries the one-line summary.

[08 — Docker image specifics](issues/08-docker-image.md) is **resolved**: two-service
docker-compose (app + Caddy sidecar, app also standalone), multi-stage from
`node:22-bookworm-slim` (glibc), `~/.claude` = named volume, `PROJECTS_ROOT` = bind
mount, secrets via env/secret-file, non-root + `init: true` + `GET /healthz`. Full
verdict in the ticket's `## Answer`; `map.md` carries the one-line summary.
Model selection and live file editing are confirmed **out of MVP** (map
"Out of scope" + `AGENTS.md`).

## What the next session is for

1. **The wayfinder effort is complete.** All eight tickets (01–08) are resolved and
   map "Not yet specified" is empty — the destination (spec + prototype) is reached.
   There is no next ticket.
2. **Nothing left open.** The product name (Clodeck) and the git remote are both
   done. The production build itself is out of scope for this effort (map "Out of
   scope") — it is the next, separate effort.

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
3. **The product name is Clodeck** (decided 2026-10-09; was the "deck" placeholder).
   npm, GitHub org/repo, and the .com were all checked free before it was chosen.
4. **Git remote is set:** `origin` → `https://github.com/clodeck/clodeck.git`
   (replaced the old `ehsannku/ClaudeUi`). The repo exists on GitHub and is empty —
   the first push will create `main`.
5. **Prototype structure:** variants share *widgets* (chat, terminal, file tree,
   code view in `common.js`) on purpose, so the comparison stays about structure;
   they share no *layout*. The file-drawer additions are opt-in via
   `FileTree({ toolbar: true })` — B and C do not pass it and are unchanged.

## Open, not yet on the map

_none — the product name and the git remote are both done; the repo is ready to go public._

## Resume

```
(effort complete — no open ticket; see "What the next session is for")
```
