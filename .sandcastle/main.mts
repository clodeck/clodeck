// Sequential Reviewer — implement-then-review, one ticket per pass.
//
// One pass is one ticket: its own branch, its own container, its own pair of
// agents. The container is what buys the clean context — every `sandbox.run()`
// spawns a fresh `claude` process, so ticket N+1 never sees ticket N's
// conversation.
//
// Which ticket is next is decided here, on the host, rather than by the agent:
// the branch name has to exist before the sandbox does, and AGENTS.md names
// branches `<effort>/<ticket>-<slug>`.
//
// Usage:
//   npm run sandcastle

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// How many tickets one run may drain. Each pass is a container, an `npm ci` and
// two agents, so this is the dial that decides what a run costs. Raise it once
// you have reviewed a branch or two and trust the loop.
const MAX_TICKETS = 3;

// AGENTS.md's branch naming, `<effort>/<ticket>-<slug>`, where the effort is the
// one under `.scratch/`.
const BRANCH_PREFIX = "clodeck";

// ---------------------------------------------------------------------------
// Git, inside the sandbox
// ---------------------------------------------------------------------------

// `git config` on this machine, or "" when the key is unset. The sandbox has to
// be told what the host takes for granted, and reading it here rather than
// writing it into a file means the two cannot drift.
const hostGit = (key: string): string => {
  try {
    return execFileSync("git", ["config", key], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

const authorName = hostGit("user.name");
const authorEmail = hostGit("user.email");

if (!authorName || !authorEmail) {
  throw new Error(
    "git has no user.name/user.email on this machine, so the sandbox could not commit anything.",
  );
}

// Where the container keeps its own copy of the repo's git hooks, and where the
// docker provider mounts the worktree. Both are hard-coded because the docker
// provider's mount is fixed and the hook directory must sit outside it.
const SANDBOX_HOOKS_DIR = "/home/agent/hooks";
const SANDBOX_REPO_DIR = "/home/agent/workspace";

// Four settings the container does not inherit, each of which stops the loop
// dead on its own:
//
//   - `core.hooksPath` points at the container's own copy of the hooks rather
//     than the worktree's. The worktree's copy cannot be run at all: Windows
//     checked it out with CRLF, so its shebang reads `#!/bin/sh\r` and the
//     kernel goes looking for an interpreter called `sh\r` — `git commit` dies
//     with "cannot run .githooks/pre-commit: No such file or directory" for a
//     file sitting right there, executable. Stripping the carriage returns in
//     place is no good either: a file that is LF where the checkout would be
//     CRLF reads as modified to git, so every pass would end with a dirty
//     worktree. A copy outside the worktree is both runnable and invisible.
//   - `core.autocrlf` is set by Git for Windows' *system* config, which a Linux
//     container has no equivalent of. Without it the container compares the
//     worktree's CRLF files against an LF index and reports every text file in
//     the repo as modified — and a `git add` would write those CRLF bytes into
//     the repository for good.
//   - `safe.directory`: a Windows bind mount hands the worktree over owned by
//     root while the container runs as `agent`, and git then refuses to touch a
//     repository it does not own. Allowing it is safe here: the container's only
//     repository is the throwaway worktree it was given.
//   - The author and committer identity. The image ships no gitconfig, so
//     `git commit` otherwise dies with "Author identity unknown" no matter how
//     well the agent did its job.
const gitConfigKeys: [key: string, value: string][] = [
  ["core.hooksPath", SANDBOX_HOOKS_DIR],
  ["safe.directory", "*"],
];
const autocrlf = hostGit("core.autocrlf");
if (autocrlf !== "") gitConfigKeys.push(["core.autocrlf", autocrlf]);

const gitEnv = {
  ...Object.fromEntries(
    gitConfigKeys.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ),
  GIT_CONFIG_COUNT: String(gitConfigKeys.length),
  GIT_AUTHOR_NAME: authorName,
  GIT_AUTHOR_EMAIL: authorEmail,
  GIT_COMMITTER_NAME: authorName,
  GIT_COMMITTER_EMAIL: authorEmail,
  // Read by `.githooks/pre-push`, which refuses to push. Nothing here pushes and
  // the container has no credentials anyway, but an agent deciding to "finish
  // the job" is the one mistake in this setup that could not be undone locally.
  CLODECK_SANDBOX: "1",
};

// Passed straight to `claude --model`, so it has to name a model the provider at
// ANTHROPIC_BASE_URL actually serves. Read from `.sandcastle/.env` first,
// because that is the file the sandbox is handed and the two must not disagree
// about which model is being asked for; the host's environment is the fallback,
// and the default is for someone pointing the loop at Anthropic directly.
const modelFromEnvFile = ((): string => {
  try {
    return readFileSync(".sandcastle/.env", "utf8").match(/^ANTHROPIC_MODEL=(.+)$/m)?.[1].trim() ?? "";
  } catch {
    return "";
  }
})();

const MODEL = modelFromEnvFile || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// The repo's pre-commit hook runs `npm run typecheck` and `npm test` on every
// commit, so the sandbox needs a working install before the agent's first commit
// or the agent cannot commit at all. The long timeout is for the bind mount: on
// Docker Desktop the worktree is the Windows filesystem, and an install over it
// is not fast.
//
// `npm ci`, not `npm install`: the container's npm is older than the host's, and
// `npm install` rewrites package-lock.json down to its own idea of the file — it
// drops the `libc` fields npm 11 writes. That leaves every pass with a dirty
// worktree, which Sandcastle preserves rather than cleans, and hands the agent a
// lockfile churn it has no business committing. `npm ci` installs exactly the
// lockfile and never writes it.
const hooks = {
  sandbox: {
    onSandboxReady: [
      // The repo's hooks, copied into the container's own filesystem and
      // stripped of the carriage returns Windows put on them, because a hook the
      // kernel cannot exec is a hook that aborts every commit. See the
      // `core.hooksPath` note above for why they cannot be fixed in place.
      {
        command: `mkdir -p ${SANDBOX_HOOKS_DIR} && for hook in .githooks/*; do sed 's/\\r$//' "$hook" > "${SANDBOX_HOOKS_DIR}/\${hook##*/}"; done && chmod +x ${SANDBOX_HOOKS_DIR}/*`,
      },
      { command: "npm ci", timeoutMs: 600_000 },
    ],
  },
};

// ---------------------------------------------------------------------------
// The ticket tracker
// ---------------------------------------------------------------------------

type Ticket = {
  id: string;
  slug: string;
  title: string;
  file: string;
};

const tracker = (...args: string[]): string =>
  execFileSync("node", ["scripts/tickets.mjs", ...args], {
    encoding: "utf8",
    // The tracker reports what it skipped, and why, on stderr — worth seeing in
    // the run's output.
    stdio: ["ignore", "pipe", "inherit"],
  });

const branchExists = (branch: string): boolean =>
  execFileSync("git", ["branch", "--list", branch], { encoding: "utf8" }).trim() !== "";

/**
 * Delete a worktree `close()` could not.
 *
 * With `node_modules` cleared inside the container first — see the loop's
 * `finally` — this is an ordinary directory and the delete is unremarkable. It
 * stays as the one place a failure is reported rather than passed over, because
 * a worktree nobody can remove occupies the path the next run for that branch
 * needs.
 */
function reapWorktree(path: string): void {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `could not remove ${path} — delete it by hand.\n  ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * The ticket this pass works on, or undefined when the queue is empty.
 *
 * A ready ticket whose branch already exists is skipped: a ticket's status only
 * reaches the host when its branch is merged, so an unmerged branch is the only
 * thing standing between the loop and redoing the same ticket.
 */
function nextTicket(): Ticket | undefined {
  for (const ticket of JSON.parse(tracker("list")) as Ticket[]) {
    const branch = `${BRANCH_PREFIX}/${ticket.id}-${ticket.slug}`;
    if (branchExists(branch)) {
      console.log(`skipping ${ticket.id}: ${branch} already exists — merge or delete it first`);
      continue;
    }
    return ticket;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

const branches: string[] = [];

for (let pass = 1; pass <= MAX_TICKETS; pass++) {
  const ticket = nextTicket();
  if (!ticket) {
    console.log("\nnothing ready to start");
    break;
  }

  const branch = `${BRANCH_PREFIX}/${ticket.id}-${ticket.slug}`;
  console.log(`\n=== pass ${pass}/${MAX_TICKETS} — ${branch}: ${ticket.title} ===\n`);

  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: docker({ env: gitEnv }),
    hooks,
  });

  try {
    const implement = await sandbox.run({
      name: `implement-${ticket.id}`,
      maxIterations: 1,
      agent: sandcastle.claudeCode(MODEL),
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs: { TICKET_ID: ticket.id, TICKET_FILE: ticket.file },
    });

    if (implement.commits.length === 0) {
      // Nothing to review means the agent got nowhere. Stop rather than move on:
      // a loop that steps over its failures quietly is a loop that wastes a
      // night and leaves nothing to show for it.
      console.log(`\nimplement-${ticket.id} committed nothing — stopping`);
      break;
    }

    branches.push(branch);

    await sandbox.run({
      name: `review-${ticket.id}`,
      maxIterations: 1,
      agent: sandcastle.claudeCode(MODEL),
      promptFile: "./.sandcastle/review-prompt.md",
      promptArgs: {
        BRANCH: branch,
        TICKET_ID: ticket.id,
        TICKET_FILE: ticket.file,
      },
    });
  } finally {
    // npm's workspace symlinks are made by Linux, and Windows cannot delete them
    // back through the bind mount: a worktree holding a `node_modules` survives
    // `close()`, leaving ~276 MB behind per pass at a path the next run for that
    // branch would find occupied. Deleting them from inside the container, with
    // the same `rm` that created them, turns the worktree back into an ordinary
    // directory — which is all `close()` needed.
    try {
      await sandbox.exec("rm -rf node_modules */node_modules");
    } catch (error) {
      console.warn(
        `could not clear node_modules before closing: ${error instanceof Error ? error.message : error}`,
      );
    }

    const worktreePath = sandbox.worktreePath;
    const closed = await sandbox.close();
    // A preserved worktree was preserved on purpose — uncommitted changes are
    // the one thing worth going back to look at — so it stays.
    if (closed.preservedWorktreePath === undefined) reapWorktree(worktreePath);
  }
}

if (branches.length > 0) {
  console.log(`\n${branches.length} branch(es) waiting on you:\n`);
  for (const branch of branches) console.log(`  ${branch}`);
  console.log("\nOne branch per ticket. Merging is yours — this loop never merges.");
}
