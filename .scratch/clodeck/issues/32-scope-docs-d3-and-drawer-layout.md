# 32: The two scope documents catch up with D3 and the drawer decision

**What to build:** Land the four decisions settled on 2026-10-12 (`prototype-parity.md` §"Tasmim-haye
gerefte-shode") in the two documents that carry scope, before any of the code tickets start — otherwise
`AGENTS.md` and `spec-04` keep describing a product that no longer exists, which is exactly the drift
that already happened once with the editable toggle.

**Blocked by:** none

**Status:** resolved

- [x] `AGENTS.md`'s **MVP scope** bullet gains the five newly-promoted items: download, markdown
      preview (Preview ⇄ Source), `size · modified` metadata, a tree ⇄ flat-list toggle, and drag-move
      of a file onto a folder.
- [x] `AGENTS.md`'s **out-of-MVP** list no longer names "markdown preview" (it is in MVP as of this
      decision); git explorer, plugins, browser-use and the model picker stay out.
- [x] `AGENTS.md`'s standing decisions record the **layout**: a rail ▸ project sidebar ▸ chat stage,
      with the terminal **and** the file drawer in a summonable bottom drawer (Variant A, decision 03).
      The current two-column reading is gone — nothing in `AGENTS.md` should still imply terminal and
      files are permanently on screen beside the chat.
- [x] `spec-04`'s **Out of Scope** section is rewritten rather than annotated: move (drag-move),
      download, markdown preview, tree ⇄ list toggle and metadata columns are in scope; the
      "Editable toggle … ba'd az MVP" line is corrected (it is in MVP and has shipped), so the section
      stops contradicting the tree it sits in.
- [x] `spec-04`'s route inventory names the two routes this new scope adds — a cross-directory **move**
      and a **download** that streams the file's bytes — or points forward at the tickets that add them.
      The surviving non-goals (no pagination, no file watching, fixed 200 MiB cap) are left alone.
- [x] Nothing in either document claims a capability that decision 03 did not: this is a promotion of
      already-decided features, not new scope.

## What landed

Docs only — no code, no tests, no `buildApp`/`protocol.ts` change.

```
AGENTS.md                                MVP bullet carries the five D3 items + a note that D3 promoted
                                         them; out-of-MVP drops "markdown preview"; a new standing
                                         decision records the Variant A layout (rail ▸ sidebar ▸ chat
                                         stage, terminal + files in one summonable bottom drawer), the
                                         sidebar holding projects only, and sessions behind History (D2);
                                         the write-posture bullet now says "never overwrite on
                                         create/upload/move".
.scratch/clodeck/spec-04-file-viewer.md  §"REST routes" gains the two routes the promoted scope adds
                                         (`GET …/files/download`, `POST …/files/move`), each pointing at
                                         its ticket; §"Out of Scope" rewritten — the five actions are
                                         listed as in-scope with their tickets, the editable toggle is
                                         recorded as shipped, and permissions stays the one metadata
                                         non-goal; the two stale editable-toggle asides (the upload
                                         route's overwrite note, the 2026-10-11 code-review entry) now
                                         point at ticket 22 / carry a superseded note.
```

Two documents claimed nothing beyond decision 03: every added item is a `decision 03` / prototype
feature, and each names the ticket that implements it. `README.md` still reads "a terminal and a file
drawer alongside" (`README.md:5`) — it is not one of the two scope documents and ticket **35** is where
that sentence goes stale; left untouched on purpose.

## Note on why this is a ticket and not a footnote

`spec-04` §"Out of Scope" is the reason. It listed the editable toggle as out of MVP *after* the user
brought it in, and its own Code-review section had to record the repair. Both documents are read at the
start of every session, so a stale one is a re-derivation cost every time. Doing this first also gives
the code tickets a settled answer to point at instead of re-arguing scope in each one.
