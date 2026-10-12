# 44: Drag a file onto a folder (and move it for real)

**What to build:** Files can be created, renamed and deleted but never relocated: today's rename is
same-directory only, so moving a file means recreating it. Make a file row draggable onto a folder row,
confirm it, and give the server the cross-directory move it is missing.

**Blocked by:** 36, 37

**Status:** ready-for-agent

- [ ] A file row can be dragged onto any folder row in the tree; the target highlights while hovered and
      clears when the drag ends or leaves.
- [ ] The **root** is a drop target too, via the breadcrumb's root crumb. The prototype could not do this
      (only folder rows accepted a drop), which would have left a file dragged out of a subfolder with
      no way home.
- [ ] Dropping opens the prototype's confirmation (`Move "x" into "y"?`); cancelling changes nothing and
      disturbs no row state.
- [ ] Confirming performs the move, re-lists the directories involved, follows the open file to its new
      path if it was the one open, and reports it through 37's toast (`moved x → y`).
- [ ] Refusals, each surfaced with a reason instead of a silent no-op: dropping into the directory the
      file already lives in; dropping a folder into itself or one of its own descendants; a name that
      already exists at the destination (no overwrite — the same posture the create route takes, and the
      save route stays the app's only deliberate overwrite).
- [ ] Server: a **move** operation on the scoped writer plus a route taking the source path and the
      destination **directory** (renaming stays `rename`'s job). Both ends are re-validated by `realpath`
      containment, the destination must be an existing directory inside the project root, the final
      segment of neither end may be a symlink, and neither end may be the project root.
- [ ] Tests: writer unit tests (happy path, escaping symlink at either end, destination not a directory,
      name collision, into-own-descendant, root as source) on a real temp sandbox; route tests for the
      status codes; web tests for the confirm, the cancel and the same-directory refusal.

## Reference

Prototype drag/drop and confirm: `prototype/common.js:431-443` (drop target), `:448-452` (draggable
rows), `:625-643` (confirm + move + toast). Scope note: `spec-04` §"Out of Scope" — "Move (drag-move) …
REST `rename` hamun-directory ast; cross-directory move ba'd miad". Parity item: D3 #19.
