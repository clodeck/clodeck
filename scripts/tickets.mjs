#!/usr/bin/env node
//
// The ticket tracker's only reader and writer.
//
// The tracker is the ticket files themselves: each one carries its state in a
// `**Status:**` line and its dependencies in a `**Blocked by:**` line. There is
// no index to fall out of sync and no service to call, which is why this file is
// a parser rather than a schema.
//
// Four commands, matching what Sandcastle's custom-tracker scaffold expects:
//
//   list [--brief]   every ticket ready to be worked on, as JSON
//   view <ID>        one ticket, verbatim
//   ready <ID>       one ticket's verdict: itself, or why it cannot start
//   close <ID>       mark one ticket resolved
//
// "Ready" means the status is `ready-for-agent` *and* every ticket it is blocked
// by is `resolved`. `list` prints what it skipped and why on stderr, so a ticket
// that is missing from the queue says where it went; `ready` gives the one
// ticket a pinned run asked for the same answer, in JSON.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

// The effort this loop drains. Ticket files are the tracker, so this one
// constant is the whole configuration.
const ISSUES_DIR = ".scratch/clodeck/issues";

const READY = "ready-for-agent";
const RESOLVED = "resolved";

const FILE_NAME = /^(\d+)-(.+)\.md$/;
const TITLE = /^#\s*\d+:\s*(.+?)\s*$/m;
const STATUS = /^(\*\*Status:\*\*[ \t]*)(.+?)([ \t\r]*)$/m;
const BLOCKED_BY = /^\*\*Blocked by:\*\*\s*(.+?)\s*$/m;

/** Every ticket in the effort, in id order. */
export function readTickets() {
  return readdirSync(ISSUES_DIR)
    .filter((name) => FILE_NAME.test(name))
    .map((name) => {
      const [, id, slug] = name.match(FILE_NAME);
      const body = readFileSync(`${ISSUES_DIR}/${name}`, "utf8");
      return {
        id,
        slug,
        // Always forward slashes: this path is interpolated into prompts that
        // only ever run inside the Linux sandbox.
        file: `${ISSUES_DIR}/${name}`,
        title: body.match(TITLE)?.[1] ?? "",
        status: body.match(STATUS)?.[2] ?? "",
        // Only the ids before the first parenthesis count — the rest of the line
        // is prose, and prose in this repo is full of ticket numbers.
        blockedBy: (body.match(BLOCKED_BY)?.[1] ?? "").split("(")[0].match(/\d+/g) ?? [],
        body,
      };
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}

const statusById = (tickets) => new Map(tickets.map((ticket) => [ticket.id, ticket.status]));

/**
 * Why this ticket cannot start now, or undefined when it can.
 *
 * The one place the readiness rule lives: `list` reports the reasons it skipped,
 * and a pinned run asks for one ticket's verdict from here, so the queue and the
 * pin cannot disagree about what "ready" means.
 */
function whyNotReady(ticket, status) {
  if (ticket.status !== READY) return `${ticket.id} is ${ticket.status}`;
  // A blocker with no ticket file counts as unresolved: leaving a ticket in the
  // queue is better than starting one whose dependency nobody can find.
  const open = ticket.blockedBy.filter((id) => status.get(id) !== RESOLVED);
  if (open.length > 0) return `${ticket.id} is blocked by ${open.join(", ")}`;
  return undefined;
}

/** The tickets worth starting now, plus a reason for each one that is not. */
export function readyTickets() {
  const all = readTickets();
  const status = statusById(all);
  const ready = [];
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

/** One ticket's verdict: the ticket, or the reason it cannot start now. */
export function readyTicket(id) {
  const all = readTickets();
  const ticket = all.find((candidate) => candidate.id === id);
  if (!ticket) return { ready: false, reason: `no ticket ${id} under ${ISSUES_DIR}` };

  const reason = whyNotReady(ticket, statusById(all));
  if (reason === undefined) return { ready: true, ...ticket };
  return { ready: false, reason };
}

/** Flip one ticket's status to `resolved`. */
export function closeTicket(id) {
  const ticket = readTickets().find((t) => t.id === id);
  if (!ticket) throw new Error(`no ticket ${id} under ${ISSUES_DIR}`);

  const source = readFileSync(ticket.file, "utf8");
  const status = source.match(STATUS);
  if (!status) throw new Error(`${ticket.file} has no **Status:** line`);
  if (status[2] === RESOLVED) return `${id} was already resolved`;

  // The captured groups keep the line's own spacing and its carriage return, so
  // the commit that closes a ticket is one changed line rather than the file.
  writeFileSync(ticket.file, source.replace(STATUS, `$1${RESOLVED}$3`));
  return `${id} resolved — ${ticket.title}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [command, argument] = process.argv.slice(2);

try {
  if (command === "list") {
    const { ready, skipped } = readyTickets();
    for (const reason of skipped) console.error(`skipped: ${reason}`);
    if (process.argv.includes("--brief")) {
      for (const ticket of ready) console.log(`${ticket.id}  ${ticket.title}`);
    } else {
      console.log(JSON.stringify(ready, null, 2));
    }
  } else if (command === "view") {
    const ticket = readTickets().find((t) => t.id === argument);
    if (!ticket) throw new Error(`no ticket ${argument} under ${ISSUES_DIR}`);
    console.log(ticket.body.trimEnd());
  } else if (command === "ready") {
    console.log(JSON.stringify(readyTicket(argument)));
  } else if (command === "close") {
    console.log(closeTicket(argument));
  } else {
    console.error("usage: tickets.mjs <list [--brief] | view <ID> | ready <ID> | close <ID>>");
    process.exit(1);
  }
} catch (error) {
  console.error(`tickets: ${error.message}`);
  process.exit(1);
}
