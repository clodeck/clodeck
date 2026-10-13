# 46: A project can be created from the UI — the decision, and the docs it moves

**What to build:** Nothing runnable. This is the decision ticket: record that **adding a project is no
longer a filesystem-only action**, then move every document that says otherwise onto the new decision —
*before* ticket 47 writes any code, so no document contradicts the product while it is being built. This
is ticket 32's pattern (docs first, then the features), for the same reason.

**Blocked by:** none

**Status:** resolved

## The decision (taken by the user, 2026-10-13)

Someone who is behind the login, in a browser, with no shell, cannot add a project: the sidebar can only
show what is already on disk. **A project can now be created from the UI.** That reverses the part of
wayfinder **decision 05** which made adding a project a filesystem action — the filesystem stays the
mechanism, it stops being the only door.

Why the reversal is affordable: decision 05 argued "a filesystem action, not a config edit" as a
*discovery* property — no lookup table, no config to keep in sync — and that still holds unchanged. A
create route introduces neither. What decision 05 never addressed is remote use, which is the product's
whole point; the terminal drawer can already `mkdir ../name`, which is the same write by a worse route.

## What stays exactly as it was

- A project is still **one immediate child directory of `PROJECTS_ROOT`**, the root is still the
  allowlist, and `id` is still `base64url` of the canonical path (05 §3, §5).
- The list is still re-scanned per request (05 §4): the switcher's refresh is unchanged and a create adds
  no cache to invalidate.
- Every containment guarantee about a project's *contents* (spec-04) is untouched — creation happens one
  level above `ScopedFs`, which cannot reach its own root by design.

## The work: the docs

- [x] `AGENTS.md` §"Standing decisions" — the project line (`Each project = one directory = …`) and the
      MVP scope bullet: creating a project from the UI is now in scope, named the way the D3-promoted
      items are named, not smuggled in.
- [x] `.scratch/clodeck/spec.md:19` — story 4 ("… so that adding a project is a filesystem action, not a
      config edit") gains the second door; the folder-on-disk sentence stays true and is not deleted.
- [x] `README.md:141` — "Drop another directory into the projects root and press the switcher's refresh"
      is no longer the only way to add one.
- [x] `.scratch/web-claude-ui/issues/05-project-discovery.md` **and** the decision-05 line in
      `.scratch/web-claude-ui/map.md`: a **superseded** pointer to this ticket. The wayfinder map is
      closed and is not rewritten — what must not survive is a reader taking its decision for current.
- [x] `.scratch/clodeck/prototype-parity.md` §P3, which lists `add-project` among the prototype's mocks
      ("P3 ra nanevis — in ha tasmim-e ghabl-and"): the same superseded pointer.
- [x] No code, and no test: nothing here is executable. `npm run typecheck` and `npm test` are the
      pre-commit hook's business and stay green because nothing in a package changed.

## What landed

Docs only — no code, no `buildApp`/route change, no test; `npm run typecheck` and `npm test` unchanged.

```
AGENTS.md                                the project line records the second door (create from the UI,
                                         root = allowlist, id = base64url, no registry); the MVP bullet
                                         names "creating a project from the sidebar" and its provenance
                                         (decision 2026-10-13, ticket 46; built by 47)
.scratch/clodeck/spec.md:19              story 4 gains the browser door — the drop-a-folder sentence
                                         survives, uncut
README.md                                "Creating one from the sidebar is coming (ticket 47)"
                                         beside the drop-and-refresh sentence — honest about 47
                                         being unbuilt
.scratch/web-claude-ui/issues/05-…md     a "Partly superseded — 2026-10-13" note at the top: the scan
                                         holds, "drop a folder in is the only door" does not
.scratch/web-claude-ui/map.md            the decision-05 line gains the same superseded clause inline
                                         — the map stays closed, the decision is not rewritten
.scratch/clodeck/prototype-parity.md     §P3's nav-rail bullet: `add-project` is no longer a mock;
                                         search/settings/session-⋯/branch-chip stay mocked
.scratch/clodeck/issues/35-…md           a dated aside on the rail bullet (not in the checklist above,
                                         but it said the same thing): the rail's three buttons stand,
                                         only its "out of MVP" clause for `add-project` is stale — the
                                         button goes in the sidebar, not the rail
```

The code tickets still read the same documents, so the point of doing this first (ticket 32's reason)
holds: by the time 47 is written, no document claims the UI cannot add a project — the sidebar's own
empty-state string still says "drop a folder into your projects root and refresh", and that is 47's to
replace, not a document.

## Code review

Both axes on the branch (Standards: `AGENTS.md`'s language rule, the repo's resolved-ticket shape, the
smell baseline; Spec: this ticket's checklist). No hard violation on either axis; the Spec axis confirmed
all six bullets present and complete.

Fixed in one pass:

1. **A present-tense instruction for a button that does not exist.** The first cut of `README.md` read
   "…or create one from the sidebar's `New project` button (ticket 47)" — a step in the try-it walkthrough
   that would fail today. It now reads "Creating one from the sidebar is coming (ticket 47)". The same
   hedge went onto `AGENTS.md`'s project line ("the route is ticket 47").
2. **Two counts in this ticket's own record were wrong** — "three superseded pointers" for four edits, and
   the ticket-35 aside missing from "What landed" (it is not in the checklist; it is named as an addition).
3. **An over-claim in the handoff** — "nothing in the repo claims the UI cannot add a project" ignored the
   sidebar's empty-state string (`ProjectSwitcher.tsx:102`), which still says "drop a folder into your
   projects root and refresh". The handoff now names that one exception and leaves it to ticket 47, which
   owns it.

Declined on purpose:

- **`AGENTS.md`'s "the root stays the allowlist … no registry" keeps its present tense.** It describes the
  standing decision, which 46 does *not* change, not a build.
- **The handoff's document table restates this ticket's "What landed".** Duplication by design — the
  handoff is read first and links back here for detail, and a handoff that points at another file for its
  own list is the one thing a handoff must not be.
- **The four superseded clauses repeat one sentence.** That is the requirement: each sits in the document
  it corrects, so a reader who opens only one of them still learns the decision moved.

## Why a separate ticket and not a line inside 47

Ticket 47 can be implemented, reviewed and reverted; this decision cannot — it is the kind of call that
outlives the code and that the next session has to be able to find (wayfinder's own "decisions, not
deliverables"). Keeping them apart is also what keeps 47 honest: by the time it is written, no document
in the repo still claims the UI cannot do this.

## Reference

- Wayfinder decision 05 — `.scratch/web-claude-ui/issues/05-project-discovery.md` and its line in `map.md`.
- `.scratch/clodeck/prototype-parity.md:135-137` — the P3 note that called `add-project` a mock.
- Ticket **32** — the same shape: a decision recorded in the docs before the code that needs it.
