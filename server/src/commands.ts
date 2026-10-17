import path from 'node:path';

import type { Project, SlashCommand } from '@clodeck/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ProjectDiscovery } from './discovery.js';
import { createScopedFs, type ScopedFs } from './files/scoped-fs.js';

/**
 * The commands a project's files declare (ticket 75): what the composer's `/`
 * menu can offer **before** a run exists.
 *
 * A command is not a clodeck concept — it is a markdown file Claude Code turns
 * into a `/name` it dispatches from the prompt string itself. So this module
 * never invents one: it reads the two places a command lives in a project, and
 * everything it answers is a file the user could open in the drawer.
 *
 * Two rules decide what is read, and both are the SDK's own rather than
 * choices made here (each checked against a real session):
 *
 * - **Upwards.** A run in a project discovers the `.claude/` of every directory
 *   from the run's own up to the projects root, so a deployment-wide skill or
 *   command loads for every project under it. Nothing *below* the project is
 *   read: a nested `.claude/skills` does not load until the agent has worked in
 *   that subdirectory, and offering one would offer a command that cannot run.
 * - **The files, not a cache.** Like the project's pin, every request reads the
 *   files again: a skill installed while a session is open is a skill the next
 *   look at the menu finds, and nothing here has an opinion about when that was.
 *
 * The route is the disk half alone. Once a run has started, the *run* is the
 * authority on what it can dispatch — it knows its own built-ins, which no file
 * on disk declares — and the two lists are joined by the client
 * (`web/src/chat/ChatPanel.tsx`), which prefers the run's the moment it has one.
 */

/** Where a project's own commands live, relative to the directory they belong to. */
const SKILLS_DIR = '.claude/skills';
const COMMANDS_DIR = '.claude/commands';

/** The one file that makes a directory a skill (`<dir>/.claude/skills/<name>/SKILL.md`). */
const SKILL_FILE = 'SKILL.md';

/** A command file: the extension is what turns a name into a command. */
const COMMAND_EXTENSION = '.md';

/**
 * `GET /api/projects/:id/commands`: everything this project's files declare.
 *
 * Registered into the app's gated `/api` scope, so — like `registerProfileRoutes`
 * beside it — it is authenticated by where it sits rather than by a rule of its
 * own, and `:id` re-enters `resolveProject`, the only place an id becomes a
 * directory.
 */
export function registerCommandRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery },
): void {
  api.get<{ Params: { id: string } }>('/projects/:id/commands', async (request, reply) => {
    const project = await options.projects.resolveProject(request.params.id);
    if (project === null) return notFound(reply);

    return { commands: await readProjectCommands(options.projects, project) };
  });
}

/**
 * Every command the project declares right now — a set, answered in a fixed
 * order: alphabetically and case-insensitively, as `profiles.ts` sorts its own
 * list. The order is this route's own rather than a directory listing's
 * accident; the *menu* still sorts what it shows, because what it shows is two
 * sources joined and it is the menu's to order (`CommandMenu.tsx`).
 *
 * A name declared twice — the same skill at the project and at the root, a
 * skill and a command that share a name — is **one row**: the nearest
 * declaration wins, because that is the one a run in this project loads last
 * and the one the user can most nearly see. Within one directory skills are
 * read before commands, which is the order the SDK itself lists them in.
 */
async function readProjectCommands(
  projects: ProjectDiscovery,
  project: Project,
): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];
  const seen = new Set<string>();

  for (const directory of await commandDirectories(projects, project.path)) {
    const files = createScopedFs(directory);
    for (const command of await readDirectory(files)) {
      if (seen.has(command.name)) continue;
      seen.add(command.name);
      commands.push(command);
    }
  }

  return commands.sort(byName);
}

/**
 * The directories a run's commands are read from, the project's first and the
 * projects root last — and never anything above the root, because the root is
 * the allowlist itself: it is the one boundary a walk *up* can still be checked
 * against. A walk is needed at all because a `.claude/skills` in a parent loads
 * for every project beneath it, which is the SDK's own rule and not a
 * convenience.
 */
async function commandDirectories(projects: ProjectDiscovery, cwd: string): Promise<string[]> {
  const root = await projects.canonicalRoot();
  // No root means no project either (an id can only resolve inside one), so the
  // walk has no bound to stop at and stays where it was asked to look.
  if (root === null) return [cwd];

  const directories: string[] = [];
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    directories.push(directory);
    // The filesystem's own top is the backstop: it is reached only by a root
    // that is not above this project, and stopping is the safe half of that.
    if (directory === root || directory === path.dirname(directory)) return directories;
  }
}

/** One directory's own declarations: its skills, then its commands. */
async function readDirectory(files: ScopedFs): Promise<SlashCommand[]> {
  return [...(await readSkills(files)), ...(await readNestedCommands(files, COMMANDS_DIR, ''))];
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every skill directory under `.claude/skills`, read through that directory's
 * own `ScopedFs`: a skill directory that escapes the directory it was declared
 * in (a symlink out of it) is not one this reads.
 */
async function readSkills(files: ScopedFs): Promise<SlashCommand[]> {
  const directory = await files.resolve(SKILLS_DIR);
  if (directory.status !== 'ok' || directory.kind !== 'directory') return [];

  const skills: SlashCommand[] = [];
  for (const entry of await files.listDir(directory.scoped)) {
    if (entry.type !== 'directory') continue;

    const declaration = await readDeclaration(files, `${SKILLS_DIR}/${entry.name}/${SKILL_FILE}`);
    if (declaration === null) continue;
    // `user-invocable: false` is a file saying it is not for this menu. Claude
    // Code hides it from the same list — its own `/` never offers it — so
    // offering it here would be a command the user could not run.
    if (!declaration.userInvocable) continue;

    // The frontmatter's `name` when it sets one, the directory's otherwise:
    // Claude Code's own rule for a skill.
    skills.push(command(declaration.name ?? entry.name, declaration));
  }
  return skills;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every `.md` under a commands directory, at any depth: a nested file is
 * namespaced with colons, so `frontend/component.md` is `/frontend:component`.
 *
 * `visited` holds the canonical directories already walked, because a symlink
 * can point a directory at an ancestor of itself — `ScopedFs` resolves such a
 * link happily (it is inside the root), and without this the walk would not end.
 */
async function readNestedCommands(
  files: ScopedFs,
  directory: string,
  namespace: string,
  visited: Set<string> = new Set(),
): Promise<SlashCommand[]> {
  const resolved = await files.resolve(directory);
  if (resolved.status !== 'ok' || resolved.kind !== 'directory') return [];
  if (visited.has(resolved.scoped)) return [];
  visited.add(resolved.scoped);

  const commands: SlashCommand[] = [];
  for (const entry of await files.listDir(resolved.scoped)) {
    const relative = `${directory}/${entry.name}`;

    if (entry.type === 'directory') {
      commands.push(...(await readNestedCommands(files, relative, `${namespace}${entry.name}:`, visited)));
      continue;
    }
    if (entry.type !== 'file' || !entry.name.endsWith(COMMAND_EXTENSION)) continue;

    const declaration = await readDeclaration(files, relative);
    if (declaration === null) continue;

    // The path names a command, never the frontmatter: `name:` in a command
    // file changes nothing, which is what a real session reports too.
    commands.push(command(`${namespace}${entry.name.slice(0, -COMMAND_EXTENSION.length)}`, declaration));
  }
  return commands;
}

/**
 * One row, from a name and what the file declared. A field the file did not
 * declare is **absent**, never a blank: nothing here invents a description for
 * a row the file left wordless, and the menu shows such a row as its name alone.
 */
function command(name: string, declaration: Declaration): SlashCommand {
  return {
    name,
    ...(declaration.description === undefined ? {} : { description: declaration.description }),
    ...(declaration.argumentHint === undefined ? {} : { argumentHint: declaration.argumentHint }),
  };
}

/* -------------------------------------------------------------------------- */
/* The files                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What one command file declares, or null when it is not a file this can read
 * (absent, a directory, binary).
 *
 * An **empty** declaration is a normal answer rather than a null one: a command
 * file with no frontmatter at all is a command with no description, and the menu
 * offers it by name — the same row a file with a description-less frontmatter
 * gets.
 */
async function readDeclaration(files: ScopedFs, relative: string): Promise<Declaration | null> {
  const resolved = await files.resolve(relative);
  if (resolved.status !== 'ok' || resolved.kind !== 'file') return null;

  const content = await files.readFile(resolved.scoped);
  if (content.kind !== 'text') return null;

  return readFrontmatter(content.content);
}

/** What a command file's frontmatter may say, and what it defaults to. */
interface Declaration {
  /** `name`: skills only — a command's name is its path. */
  name?: string;
  /** What the file says the command does. Absent when it says nothing. */
  description?: string;
  /** What the file says the command expects after its name. Absent when it says nothing. */
  argumentHint?: string;
  /** `user-invocable`, false when the file says so. A file that says nothing is invocable. */
  userInvocable: boolean;
}

/**
 * The frontmatter, as the fields a command declares.
 *
 * A deliberately small subset of YAML: one `key: value` per line, an optional
 * pair of quotes, and nothing else. A key written any other way — a nested map,
 * a value spread over several lines — declares nothing here, which is the same
 * answer as a file with no frontmatter: the row shows the name alone rather
 * than a description this reader had to guess at.
 *
 * The block must **open** the file. A `---` further down is a horizontal rule,
 * or the body of a file that has no frontmatter at all.
 */
function readFrontmatter(content: string): Declaration {
  const fields = fieldsOf(content);

  const declaration: Declaration = {
    userInvocable: fields.get('user-invocable')?.toLowerCase() !== 'false',
  };

  const name = declared(fields.get('name'));
  if (name !== undefined) declaration.name = name;

  // An empty value is nothing declared, not a blank to render: `description:`
  // on its own is a file saying no more than a file that leaves the key out.
  const description = declared(fields.get('description'));
  if (description !== undefined) declaration.description = description;

  const argumentHint = declared(fields.get('argument-hint'));
  if (argumentHint !== undefined) declaration.argumentHint = argumentHint;

  return declaration;
}

/** A declared value, trimmed — undefined when the file declared none: absent is not blank. */
function declared(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** A leading `---` block's keys, as written. */
function fieldsOf(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return fields;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '---') break;
    // An indented line belongs to a structure below this one — a nested map, a
    // list, a value spread over lines. None of them is a field at this level.
    if (line.startsWith(' ') || line.startsWith('\t')) continue;

    const separator = line.indexOf(':');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    if (key !== '') fields.set(key, unquote(line.slice(separator + 1).trim()));
  }

  return fields;
}

/** A value's own syntax removed: the quotes belong to the file, not to the text. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    // YAML's double-quoted style is JSON's, escapes and all.
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Not parseable as one: the quotes come off and nothing else is claimed.
    }
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

/** Case-insensitively alphabetical, so the menu's order does not depend on case. */
function byName(left: SlashCommand, right: SlashCommand): number {
  return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
}

/** The server's REST error shape — one envelope, no second kind (brief §ticket 09). */
function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'no allowlisted project matches this id' });
}
