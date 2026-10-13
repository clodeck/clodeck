# 46: A project can be created from the UI — the decision, and the docs it moves

**What to build:** Nothing runnable. This is the decision ticket: record that **adding a project is no
longer a filesystem-only action**, then move every document that says otherwise onto the new decision —
*before* ticket 47 writes any code, so no document contradicts the product while it is being built. This
is ticket 32's pattern (docs first, then the features), for the same reason.

**Blocked by:** none

**Status:** ready-for-agent

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

- [ ] `AGENTS.md` §"Standing decisions" — the project line (`Each project = one directory = …`) and the
      MVP scope bullet: creating a project from the UI is now in scope, named the way the D3-promoted
      items are named, not smuggled in.
- [ ] `.scratch/clodeck/spec.md:19` — story 4 ("… so that adding a project is a filesystem action, not a
      config edit") gains the second door; the folder-on-disk sentence stays true and is not deleted.
- [ ] `README.md:141` — "Drop another directory into the projects root and press the switcher's refresh"
      is no longer the only way to add one.
- [ ] `.scratch/web-claude-ui/issues/05-project-discovery.md` **and** the decision-05 line in
      `.scratch/web-claude-ui/map.md`: a **superseded** pointer to this ticket. The wayfinder map is
      closed and is not rewritten — what must not survive is a reader taking its decision for current.
- [ ] `.scratch/clodeck/prototype-parity.md` §P3, which lists `add-project` among the prototype's mocks
      ("P3 ra nanevis — in ha tasmim-e ghabl-and"): the same superseded pointer.
- [ ] No code, and no test: nothing here is executable. `npm run typecheck` and `npm test` are the
      pre-commit hook's business and stay green because nothing in a package changed.

## Why a separate ticket and not a line inside 47

Ticket 47 can be implemented, reviewed and reverted; this decision cannot — it is the kind of call that
outlives the code and that the next session has to be able to find (wayfinder's own "decisions, not
deliverables"). Keeping them apart is also what keeps 47 honest: by the time it is written, no document
in the repo still claims the UI cannot do this.

## Reference

- Wayfinder decision 05 — `.scratch/web-claude-ui/issues/05-project-discovery.md` and its line in `map.md`.
- `.scratch/clodeck/prototype-parity.md:135-137` — the P3 note that called `add-project` a mock.
- Ticket **32** — the same shape: a decision recorded in the docs before the code that needs it.
