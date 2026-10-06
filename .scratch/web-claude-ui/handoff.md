# Handoff — web-claude-ui

**Updated:** 2026-10-07
**Effort map:** [map.md](map.md) — read this first; it is the canonical state.
**This file:** the *session-to-session* layer. It holds what the map, the tickets,
and the code don't. It is committed on purpose, so a session on another machine
can pick the work up. Overwrite it each time; git history keeps the old ones.

## Where this stands

Ticket [03 — Visual prototype of the UI](issues/03-visual-prototype.md) is
**claimed, not resolved**. It is **HITL**: it closes on the user's verdict, not
on anything an agent can decide. The prototype is built, openable, and verified
working; **the user has not yet given feedback.**

Do not resolve the ticket, do not write an `## Answer`, and do not pick a
variant on the user's behalf. An agent that answers its own HITL question has
broken the contract that made the ticket worth creating.

## What the next session is for

1. Ask for the verdict — one of A / B / C, or a hybrid ("header from B, sidebar
   from C"). Hybrids are the expected good answer; the variants exist to be
   raided, not picked like a menu item.
2. Append it as `## Answer` on the ticket and set `Status: resolved`.
3. Append a one-line context pointer to `## Decisions so far` in `map.md` —
   gist + link, no restatement.
4. Graduate whatever fog the answer makes specifiable into fresh tickets
   (create-then-wire; blocking edges in a second pass). Two candidate patches
   the verdict may sharpen: the project-switcher / session-sidebar information
   hierarchy, and whether the terminal is a drawer or a peer pane. Neither
   should be ticketed *before* the verdict — the verdict is what decides them.

**One ticket per session** — do not also start
[04 — Backend transport and API shape](issues/04-backend-transport.md) in the
same session, even though it is sitting unblocked on the frontier.

## Facts that live nowhere else

1. **The prototype is verified, not just rendered.** It is driven through
   headless Chrome over CDP: files drawer, tree click → code view, terminal
   command, streaming chat (5 turns / 3 tool cards), project switch, variant
   switch, and a check that the floating bar never covers the app. It fails on
   any console error. **Re-run it with `node prototype/verify.mjs`** (Node 22+,
   no dependencies) — do not re-derive the CDP plumbing. Screenshots land in
   `<os tmpdir>/proto-shots/`; they are regenerable and are *not* committed.
2. **Four real bugs were found by that verification, all now fixed**: every SVG
   icon rendered the literal text `undefined`; two flex items never grew so
   panes didn't fill; and on `file://` the variant switcher went dead because
   the reader preferred a stale `?variant=` over the `#variant=` hash that
   `replaceState`'s fallback writes. If the user reports "the bar does nothing",
   that last class of bug is the first suspect.
3. **The product name is still a placeholder.** The UI shows
   **"deck (placeholder name)"**, because the map says this UI must carry its
   own name and one hasn't been picked. That naming decision is **fog, not a
   ticket** — don't ticket it until it's sharp.
4. **The commit `9514f77 "add prototype"` is the user's**, written by hand with
   no attribution line. Leave it alone; don't amend it.
5. **There is no git remote.** `git remote -v` is empty, so "work from another
   machine" currently means copying the folder. Adding a remote is an open,
   untracked decision — see below.
6. **Prototype structure:** variants share *widgets* (chat, terminal, file tree,
   code view in `common.js`) on purpose, so the comparison stays about
   structure; they share no *layout*. Keep that split if you add a variant.

## Open, not yet on the map

- **A git remote.** Until one exists, this repo cannot move between machines and
  nothing can be pushed. It is not a wayfinder ticket and probably doesn't
  deserve to be one — it's a one-line setup decision the user owns.
- **The product name** (see fact 3).

## Suggested skills

Call the Skill tool for:

- **wayfinder** — the session's frame; re-read it before touching the map.
- **prototype** — only if the verdict asks for changes to the prototype.
- **domain-modeling** — if naming or layout terms get settled here (e.g. whether
  "project" and "session" mean what a `GLOSSARY.md` would say). The map already
  names grilling + domain-modeling as the standing pair for this effort.

## Resume

```
/wayfinder .scratch/web-claude-ui/map.md   +  "ticket 03"
```
