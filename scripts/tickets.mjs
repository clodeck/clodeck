#!/usr/bin/env node
//
// The ticket tracker's only reader and writer.
//
// The tracker is the ticket files themselves: each one carries its state in a
// `**Status:**` line and its dependencies in a `**Blocked by:**` line. There is
// no index to fall out of sync and no service to call, which is why this file is
// a parser rather than a schema.
//
// Five commands, matching what Sandcastle's custom-tracker scaffold expects:
//
//   list [--brief]   every ticket ready to be worked on, as JSON
//   view <ID>        one ticket, verbatim
//   ready <ID>       one ticket's verdict: itself, or why it cannot start
//   close <ID>       mark one ticket resolved
//   check            every resolved ticket that still carries an open box
//
// "Ready" means the status is `ready-for-agent` *and* every ticket it is blocked
// by is `resolved`. `list` prints what it skipped and why on stderr, so a ticket
// that is missing from the queue says where it went; `ready` gives the one
// ticket a pinned run asked for the same answer, in JSON.
//
// `check` guards the other half of a ticket's state. `close` flips the status
// line and nothing else, so the checklist is the one claim only the pass that did
// the work can make — and the one that drifted: on 2026-10-15 five tickets
// reached `main` with every box still open, and nothing noticed. The pre-commit
// hook runs this, so `resolved` and "every item ticked" cannot disagree for long.
//
// Plain `.mjs`, and run by bare `node`: the implement prompt calls it from inside
// the sandbox (`.sandcastle/implement-prompt.md`), where nothing but Node is
// guaranteed. `tsconfig.tooling.json` type-checks it where it stands — with
// `checkJs`, the same strict baseline the packages use — rather than asking a
// loader of it.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The effort this loop drains by default. Ticket files are the tracker, so this
// one constant is nearly the whole configuration — the other half is
// `CLODECK_ISSUES_DIR`, which is how a test points every function here at a
// fixture directory. Every function takes the directory as its last argument for
// the same reason, and the command line keeps using the default.
const DEFAULT_ISSUES_DIR = ".scratch/clodeck/issues";

const READY = "ready-for-agent";
const RESOLVED = "resolved";

const FILE_NAME = /^(\d+)-(.+)\.md$/;
const TITLE = /^#\s*\d+:\s*(.+?)\s*$/m;
const STATUS = /^(\*\*Status:\*\*[ \t]*)(.+?)([ \t\r]*)$/m;
const BLOCKED_BY = /^\*\*Blocked by:\*\*\s*(.+?)\s*$/m;
// An unticked checklist item, and the text on its own first line — the wrapped
// continuation is not part of what `check` prints.
const OPEN_ITEM = /^- \[ \] *(.*)$/gm;

/**
 * One ticket file, as it was read off disk.
 *
 * @typedef {object} Ticket
 * @property {string} id
 * @property {string} slug
 * @property {string} file
 * @property {string} title
 * @property {string} status
 * @property {string[]} blockedBy
 * @property {string} body
 */

/** Where the ticket files are, unless the caller passes a directory instead. */
const issuesDir = () => process.env.CLODECK_ISSUES_DIR ?? DEFAULT_ISSUES_DIR;

/**
 * The one wording for a ticket that is not there, so the verdict, the close and
 * the command line cannot drift apart — pointing at a directory the run was not
 * reading is worse than saying nothing.
 *
 * @param {string} id
 * @param {string} dir
 */
function noTicket(id, dir) {
  return `no ticket ${id} under ${dir}`;
}

/**
 * Every ticket in the effort, in id order.
 *
 * @param {string} [dir] The directory to read, defaulting to the effort's own.
 * @returns {Ticket[]}
 */
export function readTickets(dir = issuesDir()) {
  // Always forward slashes: `file` is interpolated into prompts that only ever
  // run inside the Linux sandbox, and a caller that hands over a Windows path —
  // a test's fixture directory — would otherwise put backslashes in it.
  const where = dir.replaceAll("\\", "/");
  /** @type {Ticket[]} */
  const tickets = [];

  for (const name of readdirSync(dir)) {
    const match = FILE_NAME.exec(name);
    // A directory holds more than ticket files, and a match's groups are still
    // "possibly undefined" to the strict index checker even when the pattern
    // guarantees them.
    if (match === null) continue;
    const id = match[1];
    const slug = match[2];
    if (id === undefined || slug === undefined) continue;

    const body = readFileSync(`${where}/${name}`, "utf8");
    tickets.push({
      id,
      slug,
      file: `${where}/${name}`,
      title: body.match(TITLE)?.[1] ?? "",
      status: body.match(STATUS)?.[2] ?? "",
      // Only the ids before the first parenthesis count — the rest of the line
      // is prose, and prose in this repo is full of ticket numbers.
      blockedBy: (body.match(BLOCKED_BY)?.[1] ?? "").split("(")[0]?.match(/\d+/g) ?? [],
      body,
    });
  }

  return tickets.sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * @param {Ticket[]} tickets
 * @returns {Map<string, string>}
 */
const statusById = (tickets) => new Map(tickets.map((ticket) => [ticket.id, ticket.status]));

/**
 * Why this ticket cannot start now, or undefined when it can.
 *
 * The one place the readiness rule lives: `list` reports the reasons it skipped,
 * and a pinned run asks for one ticket's verdict from here, so the queue and the
 * pin cannot disagree about what "ready" means.
 *
 * @param {Ticket} ticket
 * @param {Map<string, string>} status
 * @returns {string | undefined}
 */
function whyNotReady(ticket, status) {
  if (ticket.status !== READY) return `${ticket.id} is ${ticket.status}`;
  // A blocker with no ticket file counts as unresolved: leaving a ticket in the
  // queue is better than starting one whose dependency nobody can find.
  const open = ticket.blockedBy.filter((id) => status.get(id) !== RESOLVED);
  if (open.length > 0) return `${ticket.id} is blocked by ${open.join(", ")}`;
  return undefined;
}

/**
 * The tickets worth starting now, plus a reason for each one that is not.
 *
 * @param {string} [dir]
 */
export function readyTickets(dir = issuesDir()) {
  const all = readTickets(dir);
  const status = statusById(all);
  /** @type {Ticket[]} */
  const ready = [];
  /** @type {string[]} */
  const skipped = [];

  for (const ticket of all) {
    const reason = whyNotReady(ticket, status);
    if (reason === undefined) {
      ready.push(ticket);
      continue;
    }
    // A resolved ticket is simply not up for work, and this effort has fifty of
    // them — reporting each one would drown the two lines that matter.
    if (ticket.status !== RESOLVED) skipped.push(reason);
  }

  return { ready, skipped };
}

/**
 * One ticket's verdict: the ticket, or the reason it cannot start now.
 *
 * @param {string} id
 * @param {string} [dir]
 */
export function readyTicket(id, dir = issuesDir()) {
  const all = readTickets(dir);
  const ticket = all.find((candidate) => candidate.id === id);
  if (!ticket) return { ready: false, reason: noTicket(id, dir) };

  const reason = whyNotReady(ticket, statusById(all));
  if (reason === undefined) return { ready: true, ...ticket };
  return { ready: false, reason };
}

/**
 * Flip one ticket's status to `resolved`.
 *
 * @param {string} id
 * @param {string} [dir]
 */
export function closeTicket(id, dir = issuesDir()) {
  const ticket = readTickets(dir).find((t) => t.id === id);
  if (!ticket) throw new Error(noTicket(id, dir));

  const source = readFileSync(ticket.file, "utf8");
  const status = source.match(STATUS);
  if (!status) throw new Error(`${ticket.file} has no **Status:** line`);
  if (status[2] === RESOLVED) return `${id} was already resolved`;

  // The captured groups keep the line's own spacing and its carriage return, so
  // the commit that closes a ticket is one changed line rather than the file.
  writeFileSync(ticket.file, source.replace(STATUS, `$1${RESOLVED}$3`));
  return `${id} resolved — ${ticket.title}`;
}

/**
 * Every resolved ticket that still has a box unticked, with those items.
 *
 * The rule is one sentence: a ticket that reads `resolved` has every item it
 * lists ticked. A ticket with no checklist at all — most decision tickets — has
 * nothing to tick and is never reported.
 *
 * @param {string} [dir]
 * @returns {{ ticket: Ticket, items: string[] }[]}
 */
export function unclosedTickets(dir = issuesDir()) {
  return readTickets(dir)
    .filter((ticket) => ticket.status === RESOLVED)
    .map((ticket) => ({
      ticket,
      items: [...ticket.body.matchAll(OPEN_ITEM)].map((match) => match[1] ?? ""),
    }))
    .filter(({ items }) => items.length > 0);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv Everything after `node scripts/tickets.mjs`.
 */
function main(argv) {
  const [command, id] = argv;

  try {
    if (command === "list") {
      const { ready, skipped } = readyTickets();
      for (const reason of skipped) console.error(`skipped: ${reason}`);
      if (argv.includes("--brief")) {
        for (const ticket of ready) console.log(`${ticket.id}  ${ticket.title}`);
      } else {
        console.log(JSON.stringify(ready, null, 2));
      }
      return;
    }

    if (command === "check") {
      const unclosed = unclosedTickets();
      if (unclosed.length === 0) return;
      for (const { ticket, items } of unclosed) {
        const noun = items.length === 1 ? "unticked item" : "unticked items";
        console.error(`tickets: ${ticket.id} reads ${RESOLVED} and still carries ${items.length} ${noun}:`);
        for (const item of items) console.error(`  - [ ] ${item}`);
      }
      console.error("tickets: tick every item this pass satisfied, or leave the ticket open.");
      process.exit(1);
    }

    if (command === "view" || command === "ready" || command === "close") {
      if (id === undefined) throw new Error(`${command} needs a ticket id`);
      if (command === "view") {
        const ticket = readTickets().find((t) => t.id === id);
        if (!ticket) throw new Error(noTicket(id, issuesDir()));
        console.log(ticket.body.trimEnd());
      } else if (command === "ready") {
        console.log(JSON.stringify(readyTicket(id)));
      } else {
        console.log(closeTicket(id));
      }
      return;
    }

    console.error("usage: tickets.mjs <list [--brief] | view <ID> | ready <ID> | close <ID> | check>");
    process.exit(1);
  } catch (error) {
    console.error(`tickets: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Whether this file is the process's entry point rather than an import.
 *
 * Exported, this file is a library; run as a command, it is the CLI above. The
 * guard is what lets the suite import it at all — an import must not read
 * `process.argv` — and it compares URLs so that a relative `scripts/tickets.mjs`
 * resolves against the working directory the same way the import did.
 */
function invokedDirectly() {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;

  // Windows paths are case-insensitive, so a `node SCRIPTS/tickets.mjs` typed by
  // hand would import cleanly and then close nothing at all — a tracker command
  // that reports success and changes no file is the one failure worth this line.
  const href = pathToFileURL(invoked).href;
  return process.platform === "win32"
    ? href.toLowerCase() === import.meta.url.toLowerCase()
    : href === import.meta.url;
}

if (invokedDirectly()) main(process.argv.slice(2));
