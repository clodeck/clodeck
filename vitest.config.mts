import { defineConfig } from "vitest/config";

/**
 * The repo's tooling — the ticket loop and the tracker — has no workspace to be
 * tested in: `shared`, `server` and `web` each run their own suite, and neither
 * `.sandcastle/` nor `scripts/` belongs to any of them. This is the root runner
 * that covers them, and `npm test` calls it before the workspaces so that
 * `npm test` at the root means the whole repo.
 *
 * The patterns name those two directories rather than the usual `**\/*.test.*`:
 * a repo-wide glob from the root would collect the workspaces' tests a second
 * time, which is exactly the duplication this runner must not introduce.
 * `.sandcastle/worktrees/` is matched one level deep for the same reason — it
 * holds copies of the repo, tests included.
 */
export default defineConfig({
  test: {
    include: [".sandcastle/*.test.mts", "scripts/*.test.mts"],
  },
});
