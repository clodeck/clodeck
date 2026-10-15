import { describe, expect, it, vi } from "vitest";
import {
  nextTicket,
  pinnedQueue,
  type Branches,
  type Ticket,
  type TicketSource,
  type Verdict,
} from "./queue.mjs";

/**
 * The host-side half of a run: which tickets it will work on, decided against
 * the tracker and the branch list before any container exists. Both come in as
 * arguments, which is the whole point of the module — `main.mts` reads git
 * config and creates a sandbox as it loads, so it cannot be imported, and this
 * can.
 */

const ticket = (id: string, slug: string): Ticket => ({
  id,
  slug,
  title: `title ${id}`,
  file: `.scratch/clodeck/issues/${id}-${slug}.md`,
});

/** A tracker that answers for the tickets a test names, and for no others. */
const trackerOf = (verdicts: Record<string, Verdict>): TicketSource => ({
  list: () => [],
  ready: (id) => verdicts[id] ?? { ready: false, reason: `no ticket ${id}` },
});

const noBranches: Branches = { has: () => false };

/** A tracker that prints the queue it was given, which is the unpinned loop's door. */
const listing = (...tickets: Ticket[]): TicketSource => ({
  list: () => tickets,
  ready: () => ({ ready: false, reason: "the unpinned loop never asks this" }),
});

describe("a pinned run's queue", () => {
  it("is the tickets it was given, in the order it was given them", () => {
    const first = ticket("67", "provider-seam-per-run");
    const second = ticket("65", "login-lockout-behind-a-proxy");

    const claim = pinnedQueue(
      ["67", "65"],
      trackerOf({ "67": { ready: true, ...first }, "65": { ready: true, ...second } }),
      noBranches,
    );

    // `toMatchObject` rather than `toEqual`: the tracker answers with the ticket
    // plus its own `ready` flag, and the queue hands the ticket on as it came.
    expect(claim).toMatchObject({ tickets: [first, second] });
  });

  it("is refused with the tracker's own reason when the queue holds a ticket back", () => {
    const claim = pinnedQueue(
      ["63"],
      trackerOf({ "63": { ready: false, reason: "63 is blocked by 60, 61, 62" } }),
      noBranches,
    );

    expect(claim).toEqual({ refusal: "63 is blocked by 60, 61, 62" });
  });

  it("is refused when one ticket was pinned twice, because one ticket is one branch", () => {
    const repeated = ticket("67", "provider-seam-per-run");

    const claim = pinnedQueue(
      ["67", "67"],
      trackerOf({ "67": { ready: true, ...repeated } }),
      noBranches,
    );

    expect(claim).toEqual({ refusal: "67 was pinned twice — one ticket is one branch" });
  });

  it("is refused when the branch is already there, because a pin has nowhere to go", () => {
    const taken = ticket("67", "provider-seam-per-run");
    const branches: Branches = { has: (branch) => branch === "clodeck/67-provider-seam-per-run" };

    const claim = pinnedQueue(["67"], trackerOf({ "67": { ready: true, ...taken } }), branches);

    expect(claim).toEqual({
      refusal: "clodeck/67-provider-seam-per-run already exists — merge or delete it first",
    });
  });
});

describe("the unpinned loop's next ticket", () => {
  it("steps over a ticket whose branch is already there, says which, and takes the one after it", () => {
    const taken = ticket("67", "provider-seam-per-run");
    const next = ticket("72", "tooling-under-typecheck-and-test");
    const branches: Branches = { has: (branch) => branch === "clodeck/67-provider-seam-per-run" };

    // The loop prints the skip for whoever is watching the run, so the report is
    // worth as much here as the ticket that comes back.
    const reported = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(nextTicket(listing(taken, next), branches)).toEqual(next);
      expect(reported.mock.calls.join("\n")).toContain("skipping 67: clodeck/67");
    } finally {
      reported.mockRestore();
    }
  });
});
