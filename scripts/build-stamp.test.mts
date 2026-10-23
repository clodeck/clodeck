import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectBuildStamp, UNKNOWN_COMMIT, writeBuildStamp } from "./build-stamp.mjs";

/**
 * The build stamp (`npm run build` → `server/dist/build-stamp.json`, ADR 0004).
 *
 * git is a scripted runner, not this machine's history: what is worth pinning is
 * the three answers — a repository names the build, no repository falls back to
 * the declared commit and then to `unknown`, and the dirty flag follows git's
 * porcelain. The build never fails over any of them.
 */

const NOW = new Date("2026-10-23T14:05:00.000Z");
const SHA = "fcbd770000000000000000000000000000000000";
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A git that answers the two commands the stamp asks about. */
function scriptedGit({ commit = SHA, status = "" } = {}) {
  return (args: string[]): string => {
    if (args[0] === "rev-parse") return `${commit}\n`;
    if (args[0] === "status") return status;
    return "";
  };
}

/** The git a machine without one has: every command fails. */
function noGit(): string {
  throw new Error("not a git repository");
}

describe("the build stamp", () => {
  it("names the repository's full commit, and is clean when nothing is uncommitted", () => {
    expect(collectBuildStamp({ env: {}, now: NOW, run: scriptedGit() })).toEqual({
      commit: SHA,
      builtAt: "2026-10-23T14:05:00.000Z",
      dirty: false,
    });
  });

  it("is dirty when git's porcelain has anything to say", () => {
    const stamp = collectBuildStamp({
      env: {},
      now: NOW,
      run: scriptedGit({ status: " M server/src/app.ts\n" }),
    });

    expect(stamp.dirty).toBe(true);
    // The commit is still the full 40-hex SHA; shortening is the UI's job.
    expect(stamp.commit).toBe(SHA);
  });

  it("prefers CLODECK_BUILD_COMMIT when there is no repository", () => {
    const stamp = collectBuildStamp({
      env: { CLODECK_BUILD_COMMIT: "  0123456789abcdef  " },
      now: NOW,
      run: noGit,
    });

    expect(stamp).toEqual({
      commit: "0123456789abcdef",
      builtAt: "2026-10-23T14:05:00.000Z",
      dirty: false,
    });
  });

  it("says unknown when there is neither a repository nor a declared commit", () => {
    expect(collectBuildStamp({ env: {}, now: NOW, run: noGit }).commit).toBe(UNKNOWN_COMMIT);
    // A blank declaration is a shell accident, not a commit.
    expect(
      collectBuildStamp({ env: { CLODECK_BUILD_COMMIT: "  " }, now: NOW, run: noGit }).commit,
    ).toBe(UNKNOWN_COMMIT);
  });

  it("writes the stamp beside the artifact, creating the directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "clodeck-stamp-"));
    fixtures.push(dir);
    const file = path.join(dir, "dist", "build-stamp.json");
    const stamp = { commit: SHA, builtAt: null, dirty: true };

    expect(writeBuildStamp(stamp, file)).toBe(file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(stamp);
  });
});
