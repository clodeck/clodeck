# 57: The rail cannot record a tab nothing can show

**What to build:** With no project selected the rail is fully live: clicking Files records the tab and the
drawer — which lives inside the stage and needs a project — cannot draw it. The click does nothing visible,
and the request is remembered for whenever a project is chosen. The window is the one before the first
selection: a fresh load with projects waiting for a click, or a root with none at all. Make the rail honest
there.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] With no project selected, Terminal and Files are not actionable, and the reason is available rather
      than implied — a `title` and an `aria-disabled` (or `disabled`) that says a project has to be chosen
      first.
- [ ] **Chat stays live.** Shutting the drawer is never meaningless: `Chat` is the shut state of the
      stage, so it keeps working with nothing selected, exactly as today.
- [ ] The behaviour this replaces is stated plainly, because it is deliberate: the tab used to be
      remembered across the gap, which meant a click that visibly did nothing and then acted later, after
      a selection the user had forgotten about. Dropping that is the point — a control that cannot do its
      job says so.
- [ ] Nothing else changes in that window: the stage still says `Select a project to begin.`, the sidebar
      still carries `New project` and its empty state, and no placeholder drawer or empty terminal is
      invented.
- [ ] Selecting a project restores both buttons with no other change, and a create still lands with its
      project already selected (47), so this window is the pre-selection one only.
- [ ] Tests: a rendered test drives the shell with no projects and again with projects and nothing selected,
      asserting both buttons are unavailable and that Chat still closes the drawer; a test asserts both are
      enabled once a project is selected.

## Reference

Product: `web/src/App.tsx:112-113` (`selected` is derived from `selectedId`), `:146-150` (`NothingSelected`
when nothing is selected), `:188` (the drawer exists only inside a stage that has a project), `:201-224`
(the rail, always enabled). Selection is never automatic: `setSelectedId` runs only on a user's click and
on a create (`:45-67`). Source: the "Known loose ends" list in `.scratch/clodeck/handoff.md` — ticket 35
left it as-is rather than inventing a disabled state, so this ticket is the decision it deferred.
