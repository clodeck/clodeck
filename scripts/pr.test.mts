import { describe, expect, it } from "vitest";
import { parseOpenPullRequest, publish } from "./pr.mjs";

/**
 * The publish helper (`npm run pr`), against a scripted command runner rather
 * than this machine's git and `gh`: what it is worth here is the order of the
 * steps and the message each failure leaves behind, not either tool.
 */

/** What one command answered: the shape `spawnSync` gives back. */
type Answer = { status: number; stdout?: string; stderr?: string };

/** A runner that answers each `command → args` from the map, and records every call. */
function scripted(answers: Record<string, Answer>): {
  run: (command: string, args: string[]) => { status: number; stdout: string; stderr: string };
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    run(command, args) {
      const key = [command, ...args].join(" ");
      calls.push(key);
      const answer = answers[key] ?? { status: 1, stderr: `unexpected command: ${key}` };
      return { status: answer.status, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
    },
  };
}

/** The answers every run needs before it can reach the pull request itself. */
const healthyGh = {
  "gh --version": { status: 0, stdout: "gh version 2.80.0" },
  "gh auth status": { status: 0, stdout: "Logged in to github.com" },
};

describe("the open pull request a list answers", () => {
  it("is the one entry's number and URL", () => {
    const stdout = JSON.stringify([
      { number: 12, url: "https://github.com/clodeck/clodeck/pull/12" },
    ]);

    expect(parseOpenPullRequest(stdout)).toEqual({
      number: 12,
      url: "https://github.com/clodeck/clodeck/pull/12",
    });
  });

  it("is nothing when there is no entry", () => {
    expect(parseOpenPullRequest("[]")).toBeNull();
  });

  it("is nothing when the list answered something that is not a list", () => {
    expect(parseOpenPullRequest("not json")).toBeNull();
  });
});

describe("publishing main", () => {
  it("pushes main and opens a pull request into master", () => {
    const { run, calls } = scripted({
      ...healthyGh,
      "gh pr list --base master --head main --state open --json number,url": {
        status: 0,
        stdout: "[]",
      },
      "git push origin main": { status: 0 },
      "gh pr create --base master --head main --fill": {
        status: 0,
        stdout: "https://github.com/clodeck/clodeck/pull/13\n",
      },
    });

    const result = publish({ branch: "main", run });

    expect(result).toEqual({
      ok: true,
      url: "https://github.com/clodeck/clodeck/pull/13",
      message: "https://github.com/clodeck/clodeck/pull/13",
    });
    expect(calls).toContain("git push origin main");
    expect(calls).toContain("gh pr create --base master --head main --fill");
  });

  it("still pushes main, then prints the pull request that is already open", () => {
    const { run, calls } = scripted({
      ...healthyGh,
      "git push origin main": { status: 0 },
      "gh pr list --base master --head main --state open --json number,url": {
        status: 0,
        stdout: JSON.stringify([
          { number: 7, url: "https://github.com/clodeck/clodeck/pull/7" },
        ]),
      },
    });

    const result = publish({ branch: "main", run });

    expect(result).toEqual({
      ok: true,
      url: "https://github.com/clodeck/clodeck/pull/7",
      message: "An open pull request already exists: https://github.com/clodeck/clodeck/pull/7",
    });
    // The new commits on main reach the open PR; only the duplicate create is skipped.
    expect(calls).toContain("git push origin main");
    expect(calls).not.toContain("gh pr create --base master --head main --fill");
  });

  it("refuses to publish from a branch that is not main", () => {
    const { run, calls } = scripted(healthyGh);

    const result = publish({ branch: "clodeck/93-ci-cd", run });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("main");
    expect(calls).toEqual([]);
  });
});

describe("what a failed publish says", () => {
  it("names the install and the sign-in when gh is missing", () => {
    const { run, calls } = scripted({
      "gh --version": { status: 127, stderr: "gh: command not found" },
    });

    const result = publish({ branch: "main", run });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("winget install --id GitHub.cli");
    expect(result.message).toContain("gh auth login");
    expect(calls).not.toContain("git push origin main");
  });

  it("asks for a sign-in when gh has no account", () => {
    const { run } = scripted({
      "gh --version": { status: 0 },
      "gh auth status": { status: 1, stderr: "not logged in" },
    });

    const result = publish({ branch: "main", run });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("gh auth login");
  });

  it("reports the push's own error and opens nothing", () => {
    const { run, calls } = scripted({
      ...healthyGh,
      "gh pr list --base master --head main --state open --json number,url": {
        status: 0,
        stdout: "[]",
      },
      "git push origin main": { status: 128, stderr: "remote: permission denied" },
    });

    const result = publish({ branch: "main", run });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("remote: permission denied");
    expect(calls).not.toContain("gh pr create --base master --head main --fill");
  });
});
