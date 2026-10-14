# Context

## The queue

!`node scripts/tickets.mjs list --brief`

The queue above is context, not a menu. This pass implements exactly one ticket: **{{TICKET_ID}}**.

## Recent commits

!`git log --oneline -10`

## The ticket

Source: `{{TICKET_FILE}}`

!`cat {{TICKET_FILE}}`

# Task

You are implementing ticket {{TICKET_ID}} of the clodeck effort, alone, on a branch of your own. Nothing else is in scope.

## Workflow

1. **Read the rules** — `AGENTS.md` first, then the ticket above in full.
2. **Explore** — open every file the ticket's `## Reference` section names, and the tests beside them, before writing any code.
3. **Plan** — the smallest change that satisfies every item in the ticket's checklist. The checklist *is* the acceptance criteria; a change that misses one is not done.
4. **Execute** — test first where the ticket asks for a test.
5. **Verify** — `npm run typecheck` and `npm test`, both green.
6. **Close** — `node scripts/tickets.mjs close {{TICKET_ID}}`.
7. **Commit** — one commit holding the change *and* the status flip.

## The commit

This repo's own style, from its log:

    web(50): the chat reads as one centred column
    tickets: publish 49-57 — the rejected P2 items promoted, and four loose ends

So: `<scope>(<ticket>): <what changed, and why>` — a lowercase scope, then one sentence, then the body if the change needs one. Use `web`, `server`, `shared`, `tickets` or `docs` depending on what you touched. End the message with the trailer the rest of the log carries:

    Co-Authored-By: Claude Code <noreply@anthropic.com>

## Rules

- **One ticket.** Do not start anything else in the queue.
- You are already on `{{SOURCE_BRANCH}}`. Do not commit on `main`, do not merge, do not push — the branch is the deliverable.
- Do not reach for `git commit --no-verify`. The pre-commit hook runs the typecheck and the suite; if it fails, the code is wrong.
- No commented-out code, no `TODO` left behind, no `any` cast added to quiet the compiler.
- Match the surrounding code: its naming, its comment density, its idioms.
- If you are blocked — a missing file, a test you cannot make pass — commit nothing and say so. A ticket falsely closed is worse than a ticket left open.

# Done

When your change is committed and ticket {{TICKET_ID}} reads `**Status:** resolved`, output:

<promise>COMPLETE</promise>
