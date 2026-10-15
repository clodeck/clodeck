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
that is not there. "No project" means no **id** is chosen, not that the list has yet to resolve one: the
list is in flight for the whole of every create and every refresh, and the rail is not shut for those
(see the code review below). Once it lands with the id still naming nothing — a project deleted under a
refresh — the rail shuts again, which is why the derivation asks the resolved list too. A create still
lands on its own project (47), so the rail is live by the time the new row is drawn —
`App.projects.test.tsx` keeps pinning that.

**Tests:** `web/src/App.workspace.test.tsx` gains a `the rail with no project selected` block, driven
through `Workspace` with the project list as a prop — the same seam the file already documents, so the
"no projects at all" window is expressible with no network. Six cases: no projects at all, and projects
with none chosen, both refusing Terminal and Files; the `title` carrying the reason while Chat's is its
plain name; Chat still enabled and pressed, with no drawer invented in its place; a refused click leaving
no tab recorded for the project that arrives next; and both buttons restored, and working, once
`selectedId` becomes a real project. The browser suite needs no sixth spec: every e2e spec already
selects its project before it reaches the rail.

## Code review

Two axes of review over the branch, and the three fixes they produced:

1. **The rail was shut for the whole of every create and every refresh.** The first version derived it
   from `selected`, which is null whenever `state.status !== 'ready'`, and `Shell.createProject` sets the
   id and *then* reloads — so the one moment the rail was certainly wanted, a project being born, was the
   moment it was dead, and a click there was refused where it used to be remembered. The rail now asks for
   the **id** while the list is in flight and for the resolved project once it has landed, which keeps this
   ticket's window — no id, nothing chosen — exactly as narrow as the ticket claims. Three cases in
   `App.workspace.test.tsx` pin it: live on the strength of the id, refused once more when the id never
   resolves, and still refused with no id at all.
2. **The reason could not reach a mouse.** A disabled control takes no pointer events, so its own `title`
   is not a tooltip in the browsers that matter: the reason sat on the attribute a screen reader reads and
   nowhere a pointer could reach. `RailButton` carries it on a wrapper as well, and the test asserts both
   readers rather than one.
3. **A shut button lit up under the pointer.** `:hover` still matches a disabled element, so
   `CHROME_TONE`'s resting step applied to a control that could not be clicked. It is `enabled:hover:` now,
   which is a no-op for the drawer's tabs because they are never disabled.

Declined on purpose:

- **`aria-disabled` in place of the native `disabled`.** Raised on both axes: a natively disabled control
  leaves the tab order, so a keyboard user cannot land on the rail to be told why. That is what disabled
  means here, and the ticket chose it deliberately — the browser refuses the click, so there is no handler
  left to guard and nothing to record in the gap this ticket exists to close. The reason is still in the
  accessible description, and the stage's own `Select a project to begin.` says it on screen.
- **Renaming `hasProject`.** It reads as "the root holds projects" while it holds "a project is chosen";
  `projectChosen` is the honest name. Left alone because the id-versus-resolved split above would make the
  new name misleading in the loading window without a second name for that half.

## Reference

Product: `web/src/App.tsx:112-113` (`selected` is derived from `selectedId`), `:146-150` (`NothingSelected`
when nothing is selected), `:188` (the drawer exists only inside a stage that has a project), `:201-224`
(the rail, always enabled). Selection is never automatic: `setSelectedId` runs only on a user's click and
on a create (`:45-67`). Source: the "Known loose ends" list in `.scratch/clodeck/handoff.md` — ticket 35
left it as-is rather than inventing a disabled state, so this ticket is the decision it deferred.
