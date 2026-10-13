# 35: The workspace becomes Variant A — a rail, and one bottom drawer for terminal + files

**What to build:** The product has been splitting the right-hand column in two, permanently: terminal on
top, files below, both always on screen while the chat shares the width. The verified prototype does the
opposite, and so does decision 03: the chat takes the whole stage, and the terminal and file viewer live
in a **single bottom drawer** you summon from a narrow icon rail. Move both panels into that drawer.
Their internals do not change in this ticket — only where they live and how they are summoned.

**Blocked by:** none

**Status:** resolved

- [x] An icon rail (52px) sits at the far left, spanning the full height, with a brand mark at the top
      and exactly three buttons: **Chat**, **Terminal**, **Files**. No search, no settings, no
      add-project — those prototype buttons were mocks and their features are out of MVP. *(The rail's
      three buttons stand; only the "out of MVP" clause is stale for `add-project` — superseded
      2026-10-13, ticket 46: a project is now created from the **sidebar**, not the rail, so this
      ticket's rail shape is unchanged.)*
- [x] Chat and Terminal and Files behave as one choice: picking Terminal or Files opens the drawer on
      that tab, picking Chat closes it, and the rail highlights whichever is active (Chat is active
      while the drawer is shut).
- [x] The drawer is a bottom strip about 42vh tall that **shrinks** the chat stage rather than
      overlaying it, carries the two tab buttons plus a close button in its own header, and is shut on
      first load.
- [x] Both panels keep their current behaviour inside the drawer: the terminal is the per-project real
      pty socket, the files panel is today's tree + preview + ops, and both still remount per project.
- [x] The drawer's open tab is workspace state, not per-project state: switching projects keeps the tab
      and rebuilds that tab's body for the new project (the prototype's `refreshDrawer`).
- [x] The terminal is re-fitted when the drawer opens, when its tab is switched to, and when it closes
      — a zero-height or half-rendered xterm is a failure of this ticket, not a follow-up. Same for the
      file panel's columns: both scroll independently inside the fixed drawer height.
- [x] Rail buttons and tab buttons have accessible names, and the active tab is exposed as selected.
- [x] The workspace regression test (`web/src/App.workspace.test.tsx`, from ticket 31) still asserts
      exactly one terminal after switching projects, updated for the new structure — the duplicate-key
      bug it guards is not made less likely by this move.
- [x] `npm run typecheck` and `npm test` green; `npm run build` green.

## Reference

Prototype: `prototype/variant-a.js:18` (grid `52px 244px 1fr` / rows `1fr auto`), `:21-31` (rail and
`setDrawer`), `:75-84` (drawer + tabs + close), `:153-179` (`setDrawer` / `refreshDrawer`). Current
layout: `web/src/App.tsx`'s workspace grid. Parity item: D1(a).

## What landed

```
web/src/App.tsx                 Rail (52px, brand mark + three icon buttons), the project sidebar,
                                ChatStage (header + chat + drawer), Drawer (tablist + panel), and a
                                new exported Workspace that takes the project state as a prop. `Shell`
                                is now only the hooks. DrawerTab = 'terminal' | 'files' | null.
web/src/terminal/TerminalPanel.tsx  `flex-1`, so the panel fills the drawer; the doc comment now says
                                why mounting is the fit.
web/src/files/FilePanel.tsx     `flex-1`, so the panel fills the drawer. Nothing else (ticket 36).
web/src/App.workspace.test.tsx  renders the real rail: shut on first load, Terminal summons one xterm,
                                a project switch still leaves exactly one, and the tab survives it.
                                New second test: Chat closes it and the rail reports which is active.
web/e2e/project-switch.spec.ts  drives the drawer from the rail and reads `aria-selected` to prove the
                                tab outlives the switch; switching to Files unmounts the shell.
README.md                       the sentence ticket 32 deliberately left wrong.
```

Refitting is a consequence of the structure rather than a hook: the drawer mounts a panel only while its
tab is showing, so opening the drawer, switching to the tab, and closing it are mount and unmount, and
`useTerminal`'s existing `fit.fit()` on mount plus its `ResizeObserver` cover the rest.

## Evidence

`npm run typecheck`, `npm test` (shared 9, server 230 + 7 skipped, web 96 in 11 files) and `npm run
build` green. `npm run e2e` green against `PORT=3300 npm run dev:fake` with `PROJECTS_ROOT` set — and
driven by hand in the same loop: the rail, the drawer on both tabs, and the terminal measured through
the DOM at **22 rows / 1083×308**, reopening at the same size and refitting to 16 rows after the window
was resized to 1000×700.

## Known gaps

- **The drawer is under the stage column only** (rail and sidebar span both rows), as the prototype's
  grid has it. The sidebar is still `w-72`; the prototype's 244px was not part of this ticket.
- **The rail stays enabled with no project selected.** Clicking Terminal then records a tab the drawer
  cannot show yet; picking a project afterwards opens it. Harmless, and the alternative (disabling the
  rail) is a decision this ticket was not asked to make.
- **The Files tab had a stacked layout at this ticket's own commit** — it filled the drawer, which was
  all this ticket promised. Ticket 36 lays it out `300px tree | code` and landed on the same branch.
