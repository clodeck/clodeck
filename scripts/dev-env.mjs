#!/usr/bin/env node
//
// The dev loop's door onto `.env`.
//
// This repo has no dotenv, and that is a decision rather than an omission: the
// server reads real environment variables, and `scripts/setup-clodeck.sh` writes
// `.env` plus the `start-clodeck.*` launcher that carries it into `npm run serve`.
// What that left open is the loop a developer actually works in. `npm run dev`
// reads no file, so every value the wizard captured except the two the README
// tells you to type — `UI_PASSWORD` and `PROJECTS_ROOT` — was silently absent
// from the dev loop. The wizard's own line, "nothing else does [read `.env`],
// which is what the launcher is for", was true and was the bug.
//
// What a missing value costs depends on which one it is, and the credential is
// the one that says nothing: the app comes up, the login works, the project list
// is right, and the first chat turn answers `Not logged in · Please run /login`
// — the Agent SDK's own message, naming a Claude Code CLI command that has
// nothing to do with clodeck's login screen (a real first run, 2026-10-16).
//
// So this file does one thing: read `.env`, lay it over this process's
// environment, and run the loop with it. It is deliberately not a dotenv. There
// is no dependency, no variable expansion, no quote syntax and no walk up the
// tree — a value is the text after the first `=`, and the file means the same
// thing here as it does in both launchers.
//
// Plain `.mjs`, run by bare `node`, like the tracker beside it: `tsconfig.tooling.json`
// type-checks it where it stands, and nothing needs a loader to start the loop.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The file, read from the working directory — npm runs a script from the
 * package's own directory, so this is the `.env` the launchers beside it read
 * and the one `docker compose` reads.
 */
const ENV_FILE = ".env";

/** The loop this loads it for, when the caller names no other. */
const DEFAULT_TARGET = "dev";

/**
 * One assignment, as the file spelled it.
 *
 * @typedef {object} EnvEntry
 * @property {string} key
 * @property {string} value
 */

/**
 * The assignments in `.env`'s text, in file order.
 *
 * The rules are the launchers' rules, and there are four: a blank line, a line
 * whose first non-space character is `#`, and a line with no `=` are all skipped;
 * everything else is one assignment, split at its **first** `=` so a value may
 * contain one.
 *
 * The two halves are treated differently on purpose. The **key** is trimmed,
 * because a stray space in front of a key is a typo and `.ps1` already trims it.
 * The **value** is taken verbatim, minus the carriage return a Windows editor
 * leaves behind: a password may legitimately end in a space, and `#`, `"` and `\`
 * inside a value are characters rather than syntax. That last one is the reason
 * this file exists at all rather than a `source .env` line: the shell eats the
 * backslashes of a Windows path on the way in, and a secret containing `#` would
 * be cut in half by a reader that treated it as a comment.
 *
 * @param {string} contents
 * @returns {EnvEntry[]}
 */
export function parseEnvFile(contents) {
  /** @type {EnvEntry[]} */
  const entries = [];

  for (const line of contents.split("\n")) {
    // The launchers read a line and strip one carriage return, so a CRLF file and
    // an LF file mean the same thing to all three readers.
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (text.trim() === "" || /^\s*#/.test(text)) continue;

    const separator = text.indexOf("=");
    if (separator === -1) continue;

    const key = text.slice(0, separator).trim();
    // `=value` is not an assignment to anything; exporting an empty name is not a
    // thing a shell can do either.
    if (key === "") continue;

    entries.push({ key, value: text.slice(separator + 1) });
  }

  return entries;
}

/**
 * The environment the loop is started with: what this process was given, with
 * every assignment laid over it.
 *
 * The file wins, which is what both launchers do — they set each name
 * unconditionally — and it is the useful direction: `.env` is this deployment's
 * values, and a variable that is already exported is usually one a previous
 * command left behind.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {EnvEntry[]} entries
 * @returns {NodeJS.ProcessEnv}
 */
export function withEnvFile(env, entries) {
  const merged = { ...env };
  for (const { key, value } of entries) merged[key] = value;
  return merged;
}

/**
 * What to print when there is no `.env`, with the two ways out. A verdict rather
 * than a throw, so the command line can print it without a stack trace, and so
 * the wording is testable.
 *
 * @param {string} file
 */
export function missingEnvFileMessage(file) {
  return [
    `clodeck: there is no ${file} here, so there is nothing to load.`,
    `  - create one: bash scripts/setup-clodeck.sh`,
    `  - or run the loop without it, with the variables in front: npm run ${DEFAULT_TARGET} (README step 3)`,
  ].join("\n");
}

/**
 * `.env`'s contents, or null when there is no such file.
 *
 * A file that exists but cannot be read is *not* null: that error is worth
 * raising, because the alternative is a loop that starts with half a
 * configuration and no line saying so.
 *
 * @param {string} file
 * @returns {string | null}
 */
function readEnvFile(file) {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

/**
 * `npm run <target>`, with `stdio: "inherit"` so the loop owns the terminal —
 * the same Ctrl-C, the same coloured `concurrently` prefixes, the same exit code.
 *
 * The npm to spawn is the one already running this script. npm exports
 * `npm_execpath` for the scripts it starts, so `process.execPath` on that path
 * runs the loop without a shell — which is what keeps Windows out of it: there,
 * `npm` is `npm.cmd`, Node refuses to spawn a `.cmd` without a shell, and a shell
 * concatenates arguments instead of passing them. Run by bare `node` instead,
 * there is no `npm_execpath` and the fallback takes the shell.
 *
 * @param {string} target
 * @param {NodeJS.ProcessEnv} env
 */
function runTarget(target, env) {
  const npm = process.env["npm_execpath"];
  const args = ["run", target];

  const child =
    npm === undefined || npm === ""
      ? spawn("npm", args, { stdio: "inherit", env, shell: true })
      : spawn(process.execPath, [npm, ...args], { stdio: "inherit", env });

  // The loop's exit code is this command's exit code: `Ctrl-C` on a healthy loop
  // and a failing build have to look different to a script running this.
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === null ? 0 : 1);
  });
  child.on("error", (error) => {
    console.error(`clodeck: could not start npm run ${target}: ${error.message}`);
    process.exitCode = 1;
  });
}

/**
 * Keys, never values: the line answers "did my value load?" without writing a
 * password or a credential to a terminal that scrolls back.
 *
 * @param {EnvEntry[]} entries
 * @param {string} target
 */
function loadedLine(entries, target) {
  const names = entries.map(({ key }) => key).join(", ");
  return `clodeck: ${ENV_FILE} → ${entries.length} value${entries.length === 1 ? "" : "s"} (${names}) · npm run ${target}`;
}

/**
 * @param {string[]} argv Everything after `node scripts/dev-env.mjs`.
 */
function main(argv) {
  const target = argv[0] ?? DEFAULT_TARGET;
  const contents = readEnvFile(ENV_FILE);

  if (contents === null) {
    console.error(missingEnvFileMessage(ENV_FILE));
    process.exit(1);
  }

  const entries = parseEnvFile(contents);
  console.log(loadedLine(entries, target));

  runTarget(target, withEnvFile(process.env, entries));
}

/**
 * Whether this file is the process's entry point rather than an import. The
 * suite imports it, and an import must not read `.env` or start a loop.
 *
 * Windows paths are case-insensitive, so the comparison is lowered there —
 * `node SCRIPTS/dev-env.mjs` would otherwise import cleanly and then do nothing.
 */
function invokedDirectly() {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;

  const href = pathToFileURL(invoked).href;
  return process.platform === "win32"
    ? href.toLowerCase() === import.meta.url.toLowerCase()
    : href === import.meta.url;
}

if (invokedDirectly()) main(process.argv.slice(2));
