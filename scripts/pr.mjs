#!/usr/bin/env node
//
// `npm run pr` — the one publishing step.
//
// `main` is integration; `master` is production, and the only way it moves is a
// pull request from `main` merged as a merge commit (AGENTS.md, README). Opening
// that PR by hand is two commands, and forgetting the first — pushing `main` —
// opens a PR pointing at a commit GitHub does not have yet. So this helper is
// that pair and nothing else: push `main`, then `gh pr create --base master
// --head main`.
//
// It is deliberately a helper rather than part of any workflow. Agents never
// publish (AGENTS.md); the branch they hand over is the deliverable, and a person
// runs this when they mean to move production. The checks it does before acting
// are the mistakes that cost something: the wrong branch, no `gh`, no account,
// and a PR that is already open — the last one because running the command twice
// should print the PR, not fail on a duplicate.
//
// Plain `.mjs`, run by bare `node` like the tracker beside it: no dependencies,
// and `tsconfig.tooling.json` type-checks it where it stands. The command runner
// is injected rather than reached for directly, so `pr.test.mts` can script git
// and `gh` and assert the order this file does things in.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The integration branch: what is pushed, and the head of every publish PR. */
export const SOURCE_BRANCH = "main";

/** The production branch: the base of every publish PR. */
export const TARGET_BRANCH = "master";

/**
 * What one command answered.
 *
 * @typedef {object} CommandResult
 * @property {number} status
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * A command runner. The real one spawns; a test's answers from a map.
 *
 * @typedef {(command: string, args: string[]) => CommandResult} Runner
 */

/**
 * Run one command and never throw: a missing binary is an answer with a status
 * of its own, not an exception that skips the message this file owes the user.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {CommandResult}
 */
export function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    // `status` is null when the spawn itself failed — `error` says why.
    status: result.status ?? (result.error === undefined ? 1 : 127),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

/**
 * The first pull request `gh pr list --json number,url` answered, or null when
 * there is none. Anything unreadable is also null: this only decides whether to
 * open another PR, and a list this file cannot read should not crash the publish
 * before the push it was asked for.
 *
 * @param {string} stdout
 * @returns {{ number: number; url: string } | null}
 */
export function parseOpenPullRequest(stdout) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const first = parsed[0];
  if (typeof first !== "object" || first === null) return null;
  const { number, url } = /** @type {{ number?: unknown; url?: unknown }} */ (first);
  if (typeof number !== "number" || typeof url !== "string") return null;
  return { number, url };
}

/**
 * The branch this checkout is on, or null when git cannot say (no repository, a
 * detached HEAD) — both cases in which publishing is not what was meant.
 *
 * @param {Runner} [run]
 * @returns {string | null}
 */
export function currentBranch(run = runCommand) {
  const result = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * The sentence for a missing `gh`, with the two commands that fix it. Windows is
 * named because that is the machine the README's publish runbook starts from.
 *
 * @returns {string}
 */
function ghMissing() {
  return [
    "gh is not installed, so the pull request cannot be opened.",
    "Install it with: winget install --id GitHub.cli",
    "Then sign in with: gh auth login",
  ].join("\n");
}

/**
 * A failed step as the one message this file returns: what was being attempted
 * and, when the tool said anything, its own words underneath.
 *
 * @param {string} action
 * @param {CommandResult} result
 * @returns {{ ok: false; message: string }}
 */
function failed(action, result) {
  const detail = result.stderr.trim();
  return { ok: false, message: detail === "" ? action : `${action}\n${detail}` };
}

/**
 * Push `main` and make sure a pull request into `master` is open.
 *
 * @param {object} options
 * @param {string} options.branch The branch this checkout is on.
 * @param {Runner} [options.run]
 * @returns {{ ok: boolean; message: string; url?: string }}
 */
export function publish({ branch, run = runCommand }) {
  if (branch !== SOURCE_BRANCH) {
    return {
      ok: false,
      message: `Publishing runs from ${SOURCE_BRANCH}: this checkout is on ${branch}. Switch first (git switch ${SOURCE_BRANCH}).`,
    };
  }

  const version = run("gh", ["--version"]);
  if (version.status !== 0) return { ok: false, message: ghMissing() };

  const auth = run("gh", ["auth", "status"]);
  if (auth.status !== 0) return failed("gh is not signed in. Run: gh auth login", auth);

  // Push first, always. A PR that is already open must still receive the new
  // commits on `main`; printing its URL without pushing would quietly leave the
  // production PR behind the integration branch.
  const push = run("git", ["push", "origin", SOURCE_BRANCH]);
  if (push.status !== 0) return failed(`git push origin ${SOURCE_BRANCH} failed`, push);

  const list = run("gh", [
    "pr",
    "list",
    "--base",
    TARGET_BRANCH,
    "--head",
    SOURCE_BRANCH,
    "--state",
    "open",
    "--json",
    "number,url",
  ]);
  if (list.status !== 0) return failed("Could not read the open pull requests", list);

  const open = parseOpenPullRequest(list.stdout);
  if (open !== null) {
    return {
      ok: true,
      url: open.url,
      message: `An open pull request already exists: ${open.url}`,
    };
  }

  const create = run("gh", [
    "pr",
    "create",
    "--base",
    TARGET_BRANCH,
    "--head",
    SOURCE_BRANCH,
    "--fill",
  ]);
  if (create.status !== 0) return failed("gh pr create failed", create);

  const url = create.stdout.trim();
  return { ok: true, url, message: url };
}

/** The command-line door: read the branch, publish, print the one message. */
function main() {
  const branch = currentBranch();
  if (branch === null) {
    console.error("Could not read the current branch from git.");
    process.exit(1);
  }

  const result = publish({ branch });
  if (result.ok) {
    console.log(result.message);
    return;
  }

  console.error(result.message);
  process.exit(1);
}

/**
 * Whether this file is the process's entry point rather than an import — the
 * same guard `tickets.mjs` and `dev-env.mjs` use, Windows case-folding included.
 * An import must not read the branch or run git.
 *
 * @returns {boolean}
 */
function invokedDirectly() {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;

  const href = pathToFileURL(invoked).href;
  return process.platform === "win32"
    ? href.toLowerCase() === import.meta.url.toLowerCase()
    : href === import.meta.url;
}

if (invokedDirectly()) main();
