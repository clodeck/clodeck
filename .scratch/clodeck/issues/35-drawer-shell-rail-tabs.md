# 35: The workspace becomes Variant A — a rail, and one bottom drawer for terminal + files

**What to build:** The product has been splitting the right-hand column in two, permanently: terminal on
top, files below, both always on screen while the chat shares the width. The verified prototype does the
opposite, and so does decision 03: the chat takes the whole stage, and the terminal and file viewer live
in a **single bottom drawer** you summon from a narrow icon rail. Move both panels into that drawer.
Their internals do not change in this ticket — only where they live and how they are summoned.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] An icon rail (52px) sits at the far left, spanning the full height, with a brand mark at the top
      and exactly three buttons: **Chat**, **Terminal**, **Files**. No search, no settings, no
      add-project — those prototype buttons were mocks and their features are out of MVP.
- [ ] Chat and Terminal and Files behave as one choice: picking Terminal or Files opens the drawer on
      that tab, picking Chat closes it, and the rail highlights whichever is active (Chat is active
      while the drawer is shut).
- [ ] The drawer is a bottom strip about 42vh tall that **shrinks** the chat stage rather than
      overlaying it, carries the two tab buttons plus a close button in its own header, and is shut on
      first load.
- [ ] Both panels keep their current behaviour inside the drawer: the terminal is the per-project real
      pty socket, the files panel is today's tree + preview + ops, and both still remount per project.
- [ ] The drawer's open tab is workspace state, not per-project state: switching projects keeps the tab
      and rebuilds that tab's body for the new project (the prototype's `refreshDrawer`).
- [ ] The terminal is re-fitted when the drawer opens, when its tab is switched to, and when it closes
      — a zero-height or half-rendered xterm is a failure of this ticket, not a follow-up. Same for the
      file panel's columns: both scroll independently inside the fixed drawer height.
- [ ] Rail buttons and tab buttons have accessible names, and the active tab is exposed as selected.
- [ ] The workspace regression test (`web/src/App.workspace.test.tsx`, from ticket 31) still asserts
      exactly one terminal after switching projects, updated for the new structure — the duplicate-key
      bug it guards is not made less likely by this move.
- [ ] `npm run typecheck` and `npm test` green; `npm run build` green.

## Reference

Prototype: `prototype/variant-a.js:18` (grid `52px 244px 1fr` / rows `1fr auto`), `:21-31` (rail and
`setDrawer`), `:75-84` (drawer + tabs + close), `:153-179` (`setDrawer` / `refreshDrawer`). Current
layout: `web/src/App.tsx`'s workspace grid. Parity item: D1(a).
