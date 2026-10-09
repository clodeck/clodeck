# PROTOTYPE — UI layout variants

> **Throwaway.** This folder answers one question and then dies. Nothing here is
> production code, nothing imports it, nothing is tested. It is the primary
> source for ticket [03 — Visual prototype of the UI](../issues/03-visual-prototype.md).

**Question:** what should the UI look like — project switcher + chat pane +
terminal + read-only file viewer, modeled on `claudecodeui`?

**Answer shape:** three *structurally* different layouts of the same four
surfaces, same mock data, switchable in the browser.

## Run it

Double-click `index.html`. That's it — plain `<script>` tags, no build, no
deps, no backend, no network. (If your browser is fussy about `file://`, run
`python -m http.server 8000` in this folder and open
<http://localhost:8000/>.)

## The three variants

| Key | Name | Information hierarchy |
|-----|------|----------------------|
| **A** | Chat-first, tools on demand | Chat owns the stage. Projects + sessions in a sidebar; terminal and files live in a **bottom drawer** you summon. |
| **B** | Three-pane workspace (IDE) | Four **panes, all visible**: explorer │ chat │ terminal-over-preview, plus a status bar. Everything is simultaneously on screen. |
| **C** | Project command deck | The **project is the primary object**: a switcher strip of project cards, a panel grid (chat / terminal / file), a session strip along the bottom. |

## Driving it

- **Switch variant:** the floating bar at the bottom, `←` / `→`, or the number
  keys `1` `2` `3`. The choice lands in the URL (`?variant=A`; `#variant=A` on
  `file://`, where `replaceState` is blocked).
- **Switch project:** click a project. Each project has its own sessions, file
  tree, terminal and chat history — that's the main thing to judge.
- **Send a message:** type in the composer. A reply streams in token by token
  and then two tool cards animate to `done`. This is the *only* way to judge
  the streaming feel, so do it in each variant.
- **Terminal:** click it and type. Try `ls`, `pwd`, `git status`, `git log`,
  `npm test`, `npm run dev`, `cat src/ChatPane.tsx`, `clear`.
- **File viewer:** click any file. Read-only everywhere, on purpose.
- **File drawer (variant A):** toolbar with Upload (drag-and-drop, 200 MB cap) /
  New file / New folder / Refresh / tree⇄list toggle. New items land in the
  selected folder; drag a file onto a folder (with confirm) to move it. Each row
  has a ⋯ menu for Rename (inline) / Delete (confirm). Viewer header: Download,
  Markdown preview (Preview⇄Source), per-file metadata (size · modified ·
  permissions), and a read-only⇄editable toggle.
- **Resize** (variant B): drag the gutters between panes.

The floating bar also shows the live state — `project … · session …` — and that
state survives a variant switch, so the bar reads as a control, not chrome.

## What is fake

Everything. No Agent SDK, no PTY, no filesystem, no auth, no persistence. The
chat reply and the shell responses are canned strings in `mock.js`. Project and
session names are invented. The product name shows as **deck (placeholder
name)** — the map says this UI has to carry its own name and one hasn't been
picked yet.

## Layout of the code

```
index.html      shell — loads the scripts, no build step
styles.css      shared look + component styles; variant layout rules at the end
mock.js         every fake byte lives here
common.js       shared widgets: chat, terminal, file tree, code view, icons
variant-a.js    layout A only
variant-b.js    layout B only
variant-c.js    layout C only
switcher.js     the floating bar + ?variant= + keyboard, and it mounts variants
verify.mjs      headless-Chrome check that the four interactions still work
```

## Checking an edit

`node verify.mjs` (Node 22+, no dependencies; set `CHROME_PATH` if your browser
isn't in a standard place). It drives the prototype over CDP — drawer, file
click, terminal command, streaming chat, project switch, variant switch — fails
on any console error, and drops step screenshots into `<os tmpdir>/proto-shots/`.

Worth running after any change here: the four bugs this prototype shipped with
(icons rendering the text `undefined`, two panes that never grew, the
`file://` variant switcher going dead) were all invisible in a static render
and all caught by this.

Variants share *widgets* on purpose (so the comparison stays about structure)
and share no *layout*.

## Status

Resolved — verdict: **Variant A (chat-first, tools on demand)**. The file drawer
gained toolbar actions + file actions/details (see the File drawer bullet above).
B and C remain here as reference; the verdict is recorded in
`../issues/03-visual-prototype.md`.
