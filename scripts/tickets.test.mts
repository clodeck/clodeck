import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readyTicket, readyTickets } from "./tickets.mjs";

/**
 * The tracker and the loop that drives it, against a fixture directory rather
 * than the effort's own tickets. The real ones move every time a ticket is
 * started, so a test written on them would be a test of the repository's
 * current state; these files are the four shapes the readiness rule turns on.
 */

const fixtures: string[] = [];
const SCRIPT = fileURLToPath(new URL("./tickets.mjs", import.meta.url));

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A ticket file: the id and title, the blockers and the status, and prose. */
function ticketFile(
  id: number,
  title: string,
  { status = "ready-for-agent", blockedBy = "None" }: { status?: string; blockedBy?: string } = {},
): string {
  return `# ${id}: ${title}\n\n**Blocked by:** ${blockedBy}\n\n**Status:** ${status}\n\n- [ ] the work\n`;
}

/** A directory of ticket files, which is all a tracker is. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "clodeck-tracker-"));
  fixtures.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe("one ticket's verdict", () => {
  it("is the ticket itself when it is ready and its blockers are resolved", () => {
    const dir = fixture({
      "20-early.md": ticketFile(20, "early", { status: "resolved" }),
      "21-next.md": ticketFile(21, "next", { blockedBy: "20" }),
    });

    expect(readyTicket("21", dir)).toMatchObject({ ready: true, id: "21", title: "next" });
  });

  it("is the blocker that is still open", () => {
    const dir = fixture({
      "21-next.md": ticketFile(21, "next"),
      "22-after.md": ticketFile(22, "after", { blockedBy: "21" }),
    });

    expect(readyTicket("22", dir)).toEqual({ ready: false, reason: "22 is blocked by 21" });
  });

  it("is the ticket's own status when it is resolved", () => {
    const dir = fixture({ "20-early.md": ticketFile(20, "early", { status: "resolved" }) });

    expect(readyTicket("20", dir)).toEqual({ ready: false, reason: "20 is resolved" });
  });

  it("names the directory when the id matches no ticket file", () => {
    const dir = fixture({});

    expect(readyTicket("999", dir)).toEqual({ ready: false, reason: `no ticket 999 under ${dir}` });
  });
});

describe("the queue", () => {
  it("carries every ready ticket, and a reason for each one it left out", () => {
    const dir = fixture({
      "20-early.md": ticketFile(20, "early", { status: "resolved" }),
      "21-next.md": ticketFile(21, "next"),
      "22-after.md": ticketFile(22, "after", { blockedBy: "21" }),
    });

    const { ready, skipped } = readyTickets(dir);

    expect(ready.map((ticket) => ticket.id)).toEqual(["21"]);
    // A resolved ticket is not up for work, so it is not a skip worth reporting.
    expect(skipped).toEqual(["22 is blocked by 21"]);
  });
});

describe("the tracker's command line", () => {
  it("reads the directory the environment names, so a fixture tracker is drivable the way the loop drives it", () => {
    const dir = fixture({
      "20-early.md": ticketFile(20, "early", { status: "resolved" }),
      "21-next.md": ticketFile(21, "next"),
    });

    const listed = execFileSync(process.execPath, [SCRIPT, "list", "--brief"], {
      encoding: "utf8",
      env: { ...process.env, CLODECK_ISSUES_DIR: dir },
    });

    expect(listed).toBe("21  next\n");
  });
});
