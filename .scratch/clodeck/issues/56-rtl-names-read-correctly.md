# 56: A name reads in its own direction

**What to build:** A file or project whose name is not Latin renders against the surrounding left-to-right
direction, so a Persian file name reads backwards in the tree and a Persian project name reads backwards in
the sidebar — the `demo` project has one of each. The name itself is intact everywhere it is *used*:
download saves it correctly and rename round-trips it. Only the display lies.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A name whose script runs right-to-left reads in its own order in all three places a name is drawn as a
      name: a tree row, a flat-list row, and a project row in the sidebar.
- [ ] The rule sits on the name's own element, not on the row, the listing or the panel: a row's tooltip,
      its size, its `⋯`, its indentation and the panel's own direction are unchanged, and one row cannot
      change how the row beside it reads.
- [ ] A Latin name renders exactly as it does today, and so does a name that begins with a digit,
      punctuation or an emoji. A row's layout must not depend on which script its name starts with — this
      is the trap in the obvious fix, where the first strong character of `123-…` decides the whole row.
- [ ] The change is display-only: no request, no path, no id, no download name and no dialog value is
      touched, and the name sent to the server is byte-identical to today's.
- [ ] Deliberately **not** in scope: the direction of a dialog's input (that is the user's typing, and the
      browser already handles it), and the direction of a path in a header.
- [ ] Tests: a rendered test asserts a non-ASCII file row and a non-ASCII project row carry the direction
      rule, and that a Latin row's rendering is unchanged — an assertion about the element, not about
      pixels, because jsdom lays nothing out.

## Reference

Product: `web/src/files/FilePanel.tsx:1032-1077` (`EntryMain` — one component draws a name in both
listings) and `web/src/ProjectSwitcher.tsx:104-111` (a project row). The prototype has no counterpart: its
names were ASCII mocks. Source: the "Known loose ends" list in `.scratch/clodeck/handoff.md`, which notes
the same shape on a project row as on a file row.
