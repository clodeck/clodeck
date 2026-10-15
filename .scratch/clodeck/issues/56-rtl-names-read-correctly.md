# 56: A name reads in its own direction

**What to build:** A file or project whose name is not Latin renders against the surrounding left-to-right
direction, so a Persian file name reads backwards in the tree and a Persian project name reads backwards in
the sidebar — the `demo` project has one of each. The name itself is intact everywhere it is *used*:
download saves it correctly and rename round-trips it. Only the display lies.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] A name whose script runs right-to-left reads in its own order in all three places a name is drawn as a
      name: a tree row, a flat-list row, and a project row in the sidebar.
- [x] The rule sits on the name's own element, not on the row, the listing or the panel: a row's tooltip,
      its size, its `⋯`, its indentation and the panel's own direction are unchanged, and one row cannot
      change how the row beside it reads.
- [x] A Latin name renders exactly as it does today, and so does a name that begins with a digit,
      punctuation or an emoji. A row's layout must not depend on which script its name starts with — this
      is the trap in the obvious fix, where the first strong character of `123-…` decides the whole row.
- [x] The change is display-only: no request, no path, no id, no download name and no dialog value is
      touched, and the name sent to the server is byte-identical to today's.
- [x] Deliberately **not** in scope: the direction of a dialog's input (that is the user's typing, and the
      browser already handles it), and the direction of a path in a header.
- [x] Tests: a rendered test asserts a non-ASCII file row and a non-ASCII project row carry the direction
      rule, and that a Latin row's rendering is unchanged — an assertion about the element, not about
      pixels, because jsdom lays nothing out.

**Landed as:** `web/src/Name.tsx` — **new**. One element's worth of rule: `<span dir="auto">`,
exported as `Name`. It is the browser's own first-strong rule rather than a home-rolled
`direction = …` helper, and that is what makes bullet 3 true with no code of its own: HTML skips a
leading digit, punctuation mark or emoji, and a name with no strong character at all falls back to
left-to-right — exactly what it renders as today. It is one component rather than the attribute
written out at each call site for the same reason ticket 47's dialog became one: the trap is
*where* the rule sits, and a component named `Name` cannot be set on a row by accident.

Where it went: `EntryMain` in `web/src/files/FilePanel.tsx` — the one component that draws a name
in **both** listings — for a file row, a folder row, and a symlink row (the same row with the same
name, one line away, and the one entry type that would otherwise still read backwards). The
folder's `▸`/`▾` marker and its trailing `/` stay outside the name element, so nothing of the row's
own layout is inside the rule. And the project row in `web/src/ProjectSwitcher.tsx`.

**Nothing but the pixels moves:** `Name` takes the `string` the listing carried and renders it, so
the tooltip, the `aria-label`, the download name, the rename dialog's value and every request path
still read `entry.name` / `project.name` untouched. The tests assert that shape rather than trust
it: `dirsAbove` walks from a row's button up to `<html>` and asserts no `dir` appears on the way,
which is bullet 2 stated as an assertion — the row, the listing and the panel keep the direction
the shell is laid out in, so one row cannot move because of its script, or move the row beside it.

**Left alone on purpose:** the project name in the chat header (`web/src/App.tsx:174`). The ticket
names exactly three places a name is drawn as a name and the header is a header — the one the
ticket excludes a path in. A dialog's input and a path in a header are out of scope as written.

**Tests:** `web/src/ProjectSwitcher.test.tsx` — **new**, the sidebar's rows rendered from the
component itself (the switcher's flows need the shell and stay in `App.projects.test.tsx`): a
Persian row and a Latin one, in one list. `web/src/files/FilePanel.test.tsx` — `stubFiles` grew an
opt-in `rtl` listing so the Persian row sits *beside* the Latin ones rather than in a listing of
its own, and two cases assert the rule in the tree and in the flat list. Element-level only, as
bullet 6 asks: jsdom lays nothing out, so no browser spec was added and none is named.

## Reference

Product: `web/src/files/FilePanel.tsx:1032-1077` (`EntryMain` — one component draws a name in both
listings) and `web/src/ProjectSwitcher.tsx:104-111` (a project row). The prototype has no counterpart: its
names were ASCII mocks. Source: the "Known loose ends" list in `.scratch/clodeck/handoff.md`, which notes
the same shape on a project row as on a file row.
