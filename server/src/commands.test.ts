import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectDiscovery } from './discovery.js';
import { createSandbox, createTestApp, login, removeSandbox, type Sandbox } from './test-support.js';

/**
 * The command list on disk (ticket 75): what a project's own files declare,
 * before any session exists.
 *
 * Everything asserted here was read off a **real** session's own view of the
 * same tree — a skill's frontmatter `name` winning over its directory, a
 * `user-invocable: false` skill being hidden, a nested command taking a `:`
 * namespace, and a parent directory's `.claude/skills` loading for a project
 * below it. The mirror of that is the point: what the menu offers before a run
 * and what the run itself reports are the same list.
 *
 * The route is driven through the app's own seam, exactly as a browser reaches
 * it: real directories in a sandbox, a real cookie, real JSON out.
 */

describe('the project’s commands', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-commands-');
    root = sandbox.root;
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  /** One command file's text, with frontmatter, so a fixture reads as the file does. */
  function skill(description: string, extra = ''): string {
    return `---\ndescription: ${description}\n${extra}---\n\nDo nothing.\n`;
  }

  /** Write a tree of files under `directory`, making parents as needed. */
  async function write(directory: string, files: Record<string, string>): Promise<void> {
    for (const [relative, content] of Object.entries(files)) {
      const full = path.join(directory, relative);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content);
    }
  }

  /** A project directory with the given tree inside it, as the canonical path discovery returns. */
  async function project(name: string, files: Record<string, string> = {}): Promise<string> {
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true });
    await write(directory, files);
    return realpath(directory);
  }

  /** The id the wire carries: base64url of the canonical directory. */
  function idFor(directory: string): string {
    return Buffer.from(directory, 'utf8').toString('base64url');
  }

  /** What one authenticated `GET /api/projects/:id/commands` answers. */
  async function getCommands(directory: string): Promise<{ statusCode: number; body: unknown }> {
    const app = createTestApp({ projects: createProjectDiscovery(root, { warn: () => undefined }) });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${idFor(directory)}/commands`,
        headers: { cookie: await login(app) },
      });
      return { statusCode: response.statusCode, body: response.json() };
    } finally {
      await app.close();
    }
  }

  /** Just the names, in the order the route answers them. */
  async function namesIn(directory: string): Promise<string[]> {
    const response = await getCommands(directory);
    expect(response.statusCode).toBe(200);
    const body = response.body as { commands: { name: string }[] };
    return body.commands.map((command) => command.name);
  }

  it('reads both places a command lives in, with the words each file declares', async () => {
    const directory = await project('app', {
      '.claude/skills/code-review/SKILL.md': skill('Review the diff.', 'argument-hint: [low|high]\n'),
      // No frontmatter at all: a command whose name is its file, and nothing else.
      '.claude/commands/deploy.md': 'Ship it.\n',
    });

    const response = await getCommands(directory);

    expect(response.body).toEqual({
      commands: [
        // Alphabetically, case-insensitively — the menu is scanned, not searched.
        { name: 'code-review', description: 'Review the diff.', argumentHint: '[low|high]' },
        { name: 'deploy' },
      ],
    });
  });

  it('names a skill by its frontmatter when it sets one, and by its directory otherwise', async () => {
    const directory = await project('app', {
      '.claude/skills/dir-named/SKILL.md': skill('Named by its directory.'),
      '.claude/skills/other-dir/SKILL.md': skill('Named by frontmatter.', 'name: spoken-name\n'),
      // A command's name is its path, and `name:` in one changes nothing — which
      // is what a real session reports too.
      '.claude/commands/renamed.md': '---\nname: override\ndescription: Keeps its path name.\n---\n',
    });

    expect(await namesIn(directory)).toEqual(['dir-named', 'renamed', 'spoken-name']);
  });

  it('namespaces a nested command with colons, at any depth', async () => {
    const directory = await project('app', {
      '.claude/commands/frontend/component.md': '---\ndescription: A component.\n---\n',
      '.claude/commands/frontend/forms/field.md': '---\ndescription: A field.\n---\n',
    });

    expect(await namesIn(directory)).toEqual(['frontend:component', 'frontend:forms:field']);
  });

  it('hides a skill that says it is not user-invocable', async () => {
    // Claude Code hides it from its own `/` list for the same reason: the file
    // says it is not for the user to invoke.
    const directory = await project('app', {
      '.claude/skills/hidden/SKILL.md': skill('Not for the menu.', 'user-invocable: false\n'),
      '.claude/skills/shown/SKILL.md': skill('For the menu.', 'user-invocable: true\n'),
      // A skill directory with no SKILL.md is not a skill.
      '.claude/skills/empty/README.md': 'nothing to see\n',
    });

    expect(await namesIn(directory)).toEqual(['shown']);
  });

  it('reads the parents too, up to the projects root and never above it', async () => {
    // A `.claude/skills` in a parent loads for every project beneath it, which is
    // the SDK's own rule — and the root is where it stops, because the root is
    // the allowlist. Above it is outside the deployment altogether.
    await write(root, { '.claude/skills/deployment-wide/SKILL.md': skill('Every project gets this.') });
    await write(sandbox.dir, { '.claude/skills/outside-the-root/SKILL.md': skill('Nobody gets this.') });
    const directory = await project('app', {
      '.claude/skills/mine/SKILL.md': skill('Only this project.'),
      // Below the project, not above it: the SDK does not load a nested
      // `.claude/skills` until the agent has worked in that subdirectory.
      'packages/inner/.claude/skills/nested/SKILL.md': skill('Not loaded yet.'),
    });

    expect(await namesIn(directory)).toEqual(['deployment-wide', 'mine']);
  });

  it('lets the nearest declaration win a name declared twice', async () => {
    await write(root, { '.claude/skills/shared/SKILL.md': skill('From the deployment.') });
    const directory = await project('app', {
      '.claude/skills/shared/SKILL.md': skill('From this project.'),
    });

    const response = await getCommands(directory);

    expect(response.body).toEqual({
      commands: [{ name: 'shared', description: 'From this project.' }],
    });
  });

  it('unquotes a description, and gives a file that declares none only its name', async () => {
    const directory = await project('app', {
      '.claude/commands/quoted.md': '---\ndescription: "A quoted one: with punctuation."\n---\n',
      '.claude/commands/blank.md': '---\ndescription: ""\n---\n',
    });

    expect((await getCommands(directory)).body).toEqual({
      commands: [
        { name: 'blank' },
        { name: 'quoted', description: 'A quoted one: with punctuation.' },
      ],
    });
  });

  it('offers nothing at all for a project that declares nothing', async () => {
    expect(await namesIn(await project('bare'))).toEqual([]);
  });

  it('reads the files again on every request, so a skill installed now is offered now', async () => {
    const directory = await project('app');
    expect(await namesIn(directory)).toEqual([]);

    // No cache, no invalidation, no restart: the files are the answer.
    await write(directory, { '.claude/skills/fresh/SKILL.md': skill('Just installed.') });
    expect(await namesIn(directory)).toEqual(['fresh']);
  });

  it('answers 404 for an id that is not an allowlisted project', async () => {
    const response = await getCommands(path.join(sandbox.dir, 'outside'));

    expect(response.statusCode).toBe(404);
  });

  it('is behind the same gate as every other route', async () => {
    await mkdir(path.join(root, 'app'));
    const app = createTestApp({ projects: createProjectDiscovery(root, { warn: () => undefined }) });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/projects/anything/commands' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
