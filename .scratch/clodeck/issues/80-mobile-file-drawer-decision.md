# 80: The phone's file drawer is a file with a browse sheet — the decision, and the bug the prototype found

**What to build:** Nothing more than this ticket records. This is the decision ticket for the second of
the 2026-10-20 reports: on a phone the file drawer's fixed 300px tree leaves the file about 60px wide, so
a file cannot be read or edited. It records **which shape wins**, folds it into the panel, and points at
the throwaway prototype that settled it. The build landed in the same effort, on its own branch
(`clodeck/80-mobile-file-drawer`, `25327fd`).

**Blocked by:** none

**Status:** resolved — the user chose **C (browse sheet)** on 2026-10-20, after the prototype and the
`min-w-0` fix were shown at 360×640.

## The question

`FilePanel.tsx` was two columns at every width: a fixed `w-[300px]` tree and a `flex-1 min-w-0` code
column. The drawer below `md` is a full-screen sheet, so at the ticket's 360px floor the split is *inside*
the sheet: the file column gets ~60px. That is the report. The question was the shape of the narrow
layout, not whether the file could be read at all.

## The prototype

`clodeck/file-panel-mobile-prototype` (throwaway; **not** on `main`; commits `e806e21`, `adb9f41`) adds
`web/src/files/mobilePrototype.tsx`, gated on `?variant=A|B|C` **below `md`** and absent everywhere else,
with a floating switcher and arrow-key cycling. It drives the panel's real tree and file columns and the
real project's files; only the container differs. Run `npm run dev`, open `/?variant=A`, use 360×640.

| Variant | Shape | Why it lost |
|---|---|---|
| **A — drill-down** | One pane: the tree fills the sheet; a file pick replaces it with the file plus a `‹ Files` bar | The file keeps the width, but browsing becomes a back-and-forth with no persistent list affordance, and re-picking the same file after a Back needed a click-capture workaround |
| **B — stacked panes** | Tree on top (~45%), file below, draggable divider (25–75%) | Both visible, but on a 640px-tall phone the file gets ~350px, and the divider is a thumb target for a control meant to be occasional |
| **C — browse sheet** | The file is the surface; the tree is a slide-over sheet summoned by `Browse`, open on landing, dismissed by a file pick, the ✕, or the scrim | **Chosen.** The file always has the full width, the list is on demand, and it mirrors the phone's existing sheet idiom (the drawer covers the stage rather than splitting it) |

Verdict and reasoning are the user's; C was their pick ("C made nazarame").

## The bug the prototype found (do not reintroduce)

The first C build put a flex column between the panel's `section` and the code column. That wrapper had
the default `min-width: auto`, so a file with long lines stretched the pane to its content width: the
code head measured **809px** on a 43KB file at a 360px viewport, and the `read-only` chip sat at x=716 —
off screen. It was not the 256 KiB `truncated` rule; that chip is deliberately not clickable.

Fixed with `min-w-0` on the narrow wrappers (`adb9f41`), the rule the desktop code column already had.
Verified: head 360 wide, chip visible, click still opens the editor.

## What the real implementation does

`25327fd`, on `clodeck/80-mobile-file-drawer`:

- The tree column **is** the sheet below `md`: `absolute inset-y-0 left-0 w-[86%] max-w-[320px]`, with
  `md:` classes putting the fixed column back. One copy of the tree at both sizes — the download, move,
  upload and drag wiring is not duplicated.
- The sheet has its own head below `md` (`Files` + ✕); the code column grows a `Browse` bar.
- A file pick dismisses the sheet by wrapping **one** action (`preview`) in a local `treeActions` — the
  `useFiles` seam stays free of layout concerns.
- The scrim (`Dismiss file list`) lives **inside the code column**, not as a third child of the section:
  "two direct children" is the panel's layout contract, and `FilePanel.test.tsx` asserts it.
- The sheet starts open (the drawer's usual reason to be opened is the list) and its state dies with the
  panel, like `view`; above `md` it is always shown and the state is ignored.
- **No Escape handler:** the sidebar already owns Escape, and the sheet can be launched from row menus
  whose dialogs may want the key.

## Tests

`web/e2e/responsive-layout.spec.ts` now uploads a long-line file, opens it, and asserts the code head is
exactly `WIDTH` (360) with its right edge inside the screen and the `read-only` chip visible — the
assertion that fails on the old 809px behaviour — plus all three ways out (pick, ✕, scrim) and cleanup.
The unit suite is unchanged and green; jsdom computes no layout, so the sheet's geometry is e2e-only.
The whole dev-pair suite was run against this branch: 7/7.
