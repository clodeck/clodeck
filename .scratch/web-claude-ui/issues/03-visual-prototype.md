# 03 — Visual prototype of the UI

Type: prototype
Status: resolved

## Question

What should the UI look like — project switcher + chat pane + terminal + read-only file viewer — modeled on `claudecodeui`? Build a rough, throwaway front-end prototype to react to.

## Answer

**Verdict: Variant A — "Chat-first, tools on demand"** (nav rail ▸ project + session sidebar ▸ chat stage; terminal and files live in a bottom drawer you summon).

The File Drawer — the files pane of that drawer — is specified with these capabilities, and the prototype now demonstrates them:

- **Toolbar** at the top of the drawer:
  - Upload File — picker or drag-and-drop onto the drawer, with a size cap (default 200 MB, configurable).
  - New File, New Folder — inline name prompt; creates inside the *currently selected folder* (click a folder to target it) or the project root.
  - Refresh — sync/re-render without closing the drawer.
  - Tree ⇄ Simple-list toggle ("collapse all" to a flat list).
- **File & folder operations** (via a per-row ⋯ menu, all confirmed to prevent mistakes):
  - Rename — inline prompt prefilled with the current name.
  - Delete — confirm modal (folder delete warns about contents).
  - Move — drag a file onto a folder and confirm, then it moves.
- **File actions & details:**
  - Download — real Blob download of the file's content.
  - Markdown preview — rendered view with a Preview ⇄ Source toggle (md files).
  - Metadata — size, last-modified, and Unix permissions — as columns in the simple list and a details line in the viewer header.
  - Editable toggle — the viewer starts **read-only**; clicking the read-only chip switches to an editable textarea and back.

Everything remains mock (no real FS / PTY / SDK). File metadata is derived deterministically (`fileMeta` in `common.js`); create/rename/delete/move/edit all mutate the in-memory tree, never disk. Variants B and C stay in the prototype folder as reference; A is the chosen structure.
