# 57: The rail cannot record a tab nothing can show

**What to build:** With no project selected the rail is fully live: clicking Files records the tab and the
drawer — which lives inside the stage and needs a project — cannot draw it. The click does nothing visible,
and the request is remembered for whenever a project is chosen. The window is the one before the first
selection: a fresh load with projects waiting for a click, or a root with none at all. Make the rail honest
there.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] With no project selected, Terminal and Files are not actionable, and the reason is available rather
      than implied — a `title` and an `aria-disabled` (or `disabled`) that says a project has to be chosen
      first.
- [x] **Chat stays live.** Shutting the drawer is never meaningless: `Chat` is the shut state of the
      stage, so it keeps working with nothing selected, exactly as today.
- [x] The behaviour this replaces is stated plainly, because it is deliberate: the tab used to be
      remembered across the gap, which meant a click that visibly did nothing and then acted later, after
      a selection the user had forgotten about. Dropping that is the point — a control that cannot do its
      job says so.
- [x] Nothing else changes in that window: the stage still says `Select a project to begin.`, the sidebar
      still carries `New project` and its empty state, and no placeholder drawer or empty terminal is
      invented.
- [x] Selecting a project restores both buttons with no other change, and a create still lands with its
      project already selected (47), so this window is the pre-selection one only.
- [x] Tests: a rendered test drives the shell with no projects and again with projects and nothing selected,
      asserting both buttons are unavailable and that Chat still closes the drawer; a test asserts both are
      enabled once a project is selected.

**Landed as:** `Rail` now takes `hasProject` — `selected !== null` at the one call site —
and hands it to `RailButton` as `disabled`, which `Terminal` and `Files` pass and `Chat` does not. The
native `disabled` is the repo's own idiom (`ProjectSwitcher`, `dialogs`, `Composer`) and the honest
choice over `aria-disabled`: the control leaves the tab order and the browser refuses the click outright,
so there is no handler left to guard and nothing to record. The reason rides in the `title` — `Files —
choose a project first`, from one `NO_PROJECT_REASON` constant, with the label kept so the tooltip adds
to the name rather than replacing it.

**Dropped on purpose** (checklist 3): the drawer's tab is still workspace state that outlives a project
*switch* — that is the layout decision and it is untouched — but it can no longer be recorded in the
pre-selection window, because there is no click to record. So the drawer does not spring open later on a
choice the user made before the project existed; it opens on the project's first click from the rail.
That is the one behaviour this ticket removes, and it is the point rather than a side effect.

**Unchanged in that window:** `NothingSelected` still says `Select a project to begin.`; `ProjectSwitcher`
still offers `New project` and its empty state; no drawer, shell or placeholder is mounted for a project
that is not there. Because the state can only be reached *before* the first selection, a project that
disappears under a refresh (`selected` derived, `state.projects` re-fetched) is not this window: nothing
is reset, and the next selection behaves as it always did. A create still lands on its own project (47),
so the rail is live by the time the new row is drawn — `App.projects.test.tsx` keeps pinning that.

**Tests:** `web/src/App.workspace.test.tsx` gains a `the rail with no project selected` block, driven
through `Workspace` with the project list as a prop — the same seam the file already documents, so the
"no projects at all" window is expressible with no network. Six cases: no projects at all, and projects
with none chosen, both refusing Terminal and Files; the `title` carrying the reason while Chat's is its
plain name; Chat still enabled and pressed, with no drawer invented in its place; a refused click leaving
no tab recorded for the project that arrives next; and both buttons restored, and working, once
`selectedId` becomes a real project. The browser suite needs no sixth spec: every e2e spec already
selects its project before it reaches the rail.

## Reference

Product: `web/src/App.tsx:112-113` (`selected` is derived from `selectedId`), `:146-150` (`NothingSelected`
when nothing is selected), `:188` (the drawer exists only inside a stage that has a project), `:201-224`
(the rail, always enabled). Selection is never automatic: `setSelectedId` runs only on a user's click and
on a create (`:45-67`). Source: the "Known loose ends" list in `.scratch/clodeck/handoff.md` — ticket 35
left it as-is rather than inventing a disabled state, so this ticket is the decision it deferred.
