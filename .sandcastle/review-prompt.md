# TASK

Review the changes on branch `{{BRANCH}}` for ticket {{TICKET_ID}}, and improve their clarity, consistency and maintainability **while preserving exact functionality**.

# CONTEXT

## The ticket

!`cat {{TICKET_FILE}}`

## The diff under review

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: read the ticket and the diff above to work out what was asked for and what was done.

2. **Check the ticket was actually satisfied**: walk the ticket's checklist. Every item that is not met by this diff is a finding, and the most important one — a tidy implementation of the wrong change is still the wrong change.

3. **Analyze for improvements**: look for opportunities to
   - reduce unnecessary complexity and nesting
   - eliminate redundant code and abstractions
   - improve readability through clear variable and function names
   - consolidate related logic
   - remove comments that describe obvious code
   - replace nested ternaries with a switch or an if/else chain
   - choose clarity over brevity — explicit code is often better than compact code

4. **Check correctness**:
   - does the implementation match the ticket's intent, and are its edge cases handled?
   - are the new and changed behaviours covered by tests that would fail without them?
   - are there unsafe casts, `any` types, or unchecked assumptions?
   - does the change introduce credential leaks, path escapes, or other security problems? This repo's file access is scoped to the project root by `realpath` containment — anything that weakens that is a finding.

5. **Maintain balance**: avoid an over-simplification that would reduce clarity, combine unrelated concerns into one function, remove an abstraction that earns its place, or make the code harder to debug.

6. **Apply this repo's standards**: @.sandcastle/CODING_STANDARDS.md

# EXECUTION

If you find improvements to make:

1. Make them directly on this branch.
2. Run `npm run typecheck` and `npm test`. Green, or your change comes out again.
3. Commit, in this repo's style: `<scope>(<ticket>): <what and why>`, ending with the `Co-Authored-By: Claude Code <noreply@anthropic.com>` trailer the rest of the log carries.

If the ticket was satisfied and the code is already clean, change nothing — that is a legitimate outcome, and better than churn.

# RULES

- Do not touch the ticket's status line, in either direction.
- Do not merge, do not push, do not open a pull request. `{{BRANCH}}` is the deliverable and merging it is the user's.
- Do not use `git commit --no-verify`: the pre-commit hook is the gate, and a red suite is your problem to fix, not to step around.

Once complete, output <promise>COMPLETE</promise>.
