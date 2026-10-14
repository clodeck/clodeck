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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// How many tickets one run may drain. Each pass is a container, an `npm install`
// and two agents, so this is the dial that decides what a run costs. Raise it
// once you have reviewed a branch or two and trust the loop.
const MAX_TICKETS = 3;

// AGENTS.md's branch naming, `<effort>/<ticket>-<slug>`, where the effort is the
// one under `.scratch/`.
const BRANCH_PREFIX = "clodeck";

// Passed straight to `claude --model`, so it has to name a model the provider at
// ANTHROPIC_BASE_URL actually serves. Taken from the host's environment so the
// loop and a hand-driven `npm run dev` talk to the same provider.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

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
    onSandboxReady: [{ command: "npm ci", timeoutMs: 600_000 }],
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
    sandbox: docker(),
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
    await sandbox.close();
  }
}

if (branches.length > 0) {
  console.log(`\n${branches.length} branch(es) waiting on you:\n`);
  for (const branch of branches) console.log(`  ${branch}`);
  console.log("\nOne branch per ticket. Merging is yours — this loop never merges.");
}
