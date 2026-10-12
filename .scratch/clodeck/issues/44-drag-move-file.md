# 44: Drag a file onto a folder (and move it for real)

**What to build:** Files can be created, renamed and deleted but never relocated: today's rename is
same-directory only, so moving a file means recreating it. Make a file row draggable onto a folder row,
confirm it, and give the server the cross-directory move it is missing.

**Blocked by:** 36, 37

**Status:** resolved

- [x] A file row can be dragged onto any folder row in the tree; the target highlights while hovered and
      clears when the drag ends or leaves.
- [x] The **root** is a drop target too, via the breadcrumb's root crumb. The prototype could not do this
      (only folder rows accepted a drop), which would have left a file dragged out of a subfolder with
      no way home.
- [x] Dropping opens the prototype's confirmation (`Move "x" into "y"?`); cancelling changes nothing and
      disturbs no row state.
- [x] Confirming performs the move, re-lists the directories involved, follows the open file to its new
      path if it was the one open, and reports it through 37's toast (`moved x → y`).
- [x] Refusals, each surfaced with a reason instead of a silent no-op: dropping into the directory the
      file already lives in; dropping a folder into itself or one of its own descendants; a name that
      already exists at the destination (no overwrite — the same posture the create route takes, and the
      save route stays the app's only deliberate overwrite).
- [x] Server: a **move** operation on the scoped writer plus a route taking the source path and the
      destination **directory** (renaming stays `rename`'s job). Both ends are re-validated by `realpath`
      containment, the destination must be an existing directory inside the project root, the final
      segment of neither end may be a symlink, and neither end may be the project root.
- [x] Tests: writer unit tests (happy path, escaping symlink at either end, destination not a directory,
      name collision, into-own-descendant, root as source) on a real temp sandbox; route tests for the
      status codes; web tests for the confirm, the cancel and the same-directory refusal.

**Landed as:** `ScopedFs.move(source: WriteTarget, destDir: ScopedPath)` → its own `MoveResult` union
(the four arms it shares with `WriteResult` plus `same_directory`, `into_own_descendant` and
`not_a_directory` — arms no other write op can return), and `POST /api/projects/:id/files/move` whose
body `to` is a *path* and so passes `relPath`'s syntax check rather than `name()`'s. `relPath` grew the
`isRelative` it had always been; the destination goes through `resolve` (the reader's door), the source
through `resolveWriteTarget`. On the client the seam gained `move(path, dest)`; the panel holds the drag
(`dragging`/`over`) and a `MoveControl` handed to the tree rows and the root crumb, the `MoveDialog` is
the prototype's question with the server's refusal kept in it, and the toast says `moved x → y`.
Seen in the browser: `evidence/44-drag-target.png`, `evidence/44-move-confirm.png`.

**Three interpretations worth naming:**

1. **"Dropping opens the confirmation" is taken literally**, so a drop into the folder the file already
   lives in still opens the dialog — and confirming *that* is refused with `already in <folder>`, as the
   prototype's `moveNode` does. The refusal is the client's own (no request); the same move attempted
   over the wire is a `409`.
2. **The breadcrumb now renders in tree mode as well.** Ticket 41 left the tree a plain `in <folder>`
   line; the root crumb is the only drop target a file dragged out of a subfolder has, so both listings
   show the trail now. The tree's crumb buttons go through the same `openDir` the flat list's do.
3. **The follow is not just the open file's own path.** A file *inside* a folder that moves follows too —
   it is the same staleness, one level down, and the delete path already handles that shape.
4. **"No symlink in either final segment" turned out to be true of the source only.** A symlink as the
   *source* is refused (a link is never moved onto its target), but the destination goes through the
   reader's `resolve`, which follows an in-root link by design — that is what makes a linked directory
   navigable, and every other write accepts it too (`createFile`'s parent is resolved the same way). So a
   drop into an in-root linked folder lands in what it points at. Refusing it here would have made `move`
   the one write that rejects what `create` accepts; containment still holds, and a link that leaves the
   root is a `404` like any other miss. `spec-04` now says this rather than the other thing.

## Reference

Prototype drag/drop and confirm: `prototype/common.js:431-443` (drop target), `:448-452` (draggable
rows), `:625-643` (confirm + move + toast). Scope note: `spec-04` §"Out of Scope" — "Move (drag-move) …
REST `rename` hamun-directory ast; cross-directory move ba'd miad". Parity item: D3 #19.
