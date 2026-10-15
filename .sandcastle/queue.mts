// The host-side half of the ticket loop: which tickets a run will work on.
//
// It lives apart from `main.mts` because that file cannot be imported — it reads
// git config and creates a sandbox as it loads — and the choice it makes before
// any container exists is the part worth a test. So the tracker and the branch
// list arrive as two small ports: each has a real implementation here that
// shells out, and a test answers with its own.

import { execFileSync } from "node:child_process";

// AGENTS.md's branch naming, `<effort>/<ticket>-<slug>`, where the effort is the
// one under `.scratch/`.
const BRANCH_PREFIX = "clodeck";

export type Ticket = {
  id: string;
  slug: string;
  title: string;
  file: string;
};

/** What the tracker answers for one ticket a run was pinned to. */
export type Verdict = ({ ready: true } & Ticket) | { ready: false; reason: string };

/** The tracker, as this half of the loop uses it. */
export type TicketSource = {
  list(): Ticket[];
  ready(id: string): Verdict;
};

/** The branch list, as this half of the loop uses it. */
export type Branches = {
  has(branch: string): boolean;
};

export const branchOf = (ticket: Ticket): string => `${BRANCH_PREFIX}/${ticket.id}-${ticket.slug}`;

/**
 * Why a run will not touch a branch that is already there. The unpinned loop
 * reports it and takes the next ticket; a pinned run has nowhere to go and stops.
 */
const branchTaken = (branch: string): string => `${branch} already exists — merge or delete it first`;

/**
 * The ticket the unpinned loop works on next, or undefined when the queue is
 * empty.
 *
 * A ready ticket whose branch already exists is skipped: a ticket's status only
 * reaches the host when its branch is merged, so an unmerged branch is the only
 * thing standing between the loop and redoing the same ticket.
 */
export function nextTicket(tickets: TicketSource, branches: Branches): Ticket | undefined {
  for (const ticket of tickets.list()) {
    const branch = branchOf(ticket);
    if (branches.has(branch)) {
      console.log(`skipping ${ticket.id}: ${branchTaken(branch)}`);
      continue;
    }
    return ticket;
  }
  return undefined;
}

/**
 * The tickets a pinned run will work on, in the order given — or the one reason
 * it will not run at all.
 *
 * Every question here is answered on the host, against the tracker and the
 * branch list, before any container exists: a request that cannot be honoured
 * must not cost a container, and must say why rather than quietly working on
 * some other ticket.
 */
export function pinnedQueue(
  ids: string[],
  tickets: TicketSource,
  branches: Branches,
): { tickets: Ticket[] } | { refusal: string } {
  const claimed: Ticket[] = [];
  for (const id of ids) {
    // Naming one ticket twice would put two passes on one branch, which is the
    // collision this flag exists to make impossible.
    if (claimed.some((ticket) => ticket.id === id)) {
      return { refusal: `${id} was pinned twice — one ticket is one branch` };
    }

    // "Ready" is the tracker's to answer, and it answers with the reason `list`
    // would have skipped the ticket for, so a pin cannot start what the queue
    // holds back.
    const verdict = tickets.ready(id);
    if (!verdict.ready) return { refusal: verdict.reason };

    // The verdict is the ticket — the tracker answers with the same object `list`
    // prints, so there is nothing here to pick apart.
    const ticket: Ticket = verdict;

    // Where the unpinned loop skips a branch that already exists and takes the
    // next ticket, a pin has nowhere to go — and Sandcastle, finding that
    // branch's worktree clean, would quietly reuse it and put this pass's agent
    // into whatever is already there.
    const branch = branchOf(ticket);
    if (branches.has(branch)) return { refusal: branchTaken(branch) };

    claimed.push(ticket);
  }
  return { tickets: claimed };
}

// ---------------------------------------------------------------------------
// The real ports
// ---------------------------------------------------------------------------

/** The tracker as the loop runs it: this repo's own script, over a subprocess. */
export function ticketTracker(): TicketSource {
  const run = (...args: string[]): string =>
    execFileSync("node", ["scripts/tickets.mjs", ...args], {
      encoding: "utf8",
      // The tracker reports what it skipped, and why, on stderr — worth seeing in
      // the run's output.
      stdio: ["ignore", "pipe", "inherit"],
    });

  // The tracker is this repository's own script, so this is a parse of a
  // contract the two halves of the loop share rather than of anything unknown.
  return {
    list: () => JSON.parse(run("list")) as Ticket[],
    ready: (id) => JSON.parse(run("ready", id)) as Verdict,
  };
}

/** The branch list as the loop runs it: one `git branch --list` per question. */
export function gitBranches(): Branches {
  return {
    has: (branch) =>
      execFileSync("git", ["branch", "--list", branch], { encoding: "utf8" }).trim() !== "",
  };
}
