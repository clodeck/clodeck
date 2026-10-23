#!/usr/bin/env node
//
// Writes the build stamp into the server artifact (`server/dist/build-stamp.json`),
// beside the code it describes. `npm run build` runs this last, and the server
// reads the file once at boot (ADR 0004).
//
// The stamp answers "which build is this?", not "which checkout is next to it?":
// it is written now, from the tree that is being compiled. A build that cannot
// see git — the Docker build context excludes `.git` — reports
// `CLODECK_BUILD_COMMIT` when the operator declared one, and `unknown` otherwise.
// Neither stops the build: an empty stamp would be the lie the feature exists to
// prevent, so the honest words are written instead.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} BuildStamp
 * @property {string} commit
 * @property {string | null} builtAt
 * @property {boolean} dirty
 */

/**
 * One git invocation, answering its stdout. Injectable so the suite does not
 * depend on this machine's git, its global config or its history.
 *
 * @callback GitRun
 * @param {string[]} args
 * @returns {string}
 */

/** What git alone says about the tree being built. */
/**
 * @typedef {object} GitFacts
 * @property {string} commit
 * @property {boolean} dirty
 */

/** What the stamp says when neither git nor the environment can name a commit. */
export const UNKNOWN_COMMIT = "unknown";

/** Where the artifact lives, relative to this script's own directory. */
export const STAMP_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
  "dist",
  "build-stamp.json",
);

/**
 * A git runner for one directory. A missing git or a directory that is not a
 * repository is an expected state rather than a crash: the caller turns the
 * failure into `CLODECK_BUILD_COMMIT` or `unknown`.
 *
 * @param {string} [cwd]
 * @returns {GitRun}
 */
export function gitRunner(cwd = process.cwd()) {
  return (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
}

/**
 * The commit and dirtiness from git, or `null` when this is not a repository
 * (or has no commit yet). The commit stays the full 40-hex SHA: shortening is a
 * display decision, made where the stamp is shown.
 *
 * @param {GitRun} run
 * @returns {GitFacts | null}
 */
export function stampFromGit(run) {
  try {
    const commit = run(["rev-parse", "HEAD"]).trim();
    if (commit === "") return null;
    return { commit, dirty: run(["status", "--porcelain"]).trim() !== "" };
  } catch {
    return null;
  }
}

/**
 * The stamp for the build that is running now.
 *
 * A repository wins: the tree being compiled is the truth. Only without one does
 * `CLODECK_BUILD_COMMIT` have anything to say (the Docker build arg), and only
 * when that is blank too does the stamp read `unknown`.
 *
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, now?: Date, run?: GitRun }} [options]
 * @returns {BuildStamp}
 */
export function collectBuildStamp({
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
  run = gitRunner(cwd),
} = {}) {
  const fromGit = stampFromGit(run);
  const declared = env["CLODECK_BUILD_COMMIT"]?.trim();

  return {
    commit: fromGit?.commit ?? (declared ? declared : UNKNOWN_COMMIT),
    builtAt: now.toISOString(),
    // Without a repository there is no working tree to call dirty.
    dirty: fromGit?.dirty ?? false,
  };
}

/**
 * Write the stamp where the server reads it: beside its compiled code.
 *
 * @param {BuildStamp} stamp
 * @param {string} [file]
 * @returns {string}
 */
export function writeBuildStamp(stamp, file = STAMP_PATH) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stamp, null, 2)}\n`);
  return file;
}

// Imported by the suite for its functions; only a direct run writes anything.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stamp = collectBuildStamp();
  const file = writeBuildStamp(stamp);
  console.log(
    `build stamp: ${stamp.commit}${stamp.dirty ? "-dirty" : ""} at ${stamp.builtAt} → ${file}`,
  );
}
