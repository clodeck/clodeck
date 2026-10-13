import { lstat, mkdir, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectDiscovery } from './discovery.js';
import { createSandbox, linkType, removeSandbox, type Sandbox } from './test-support.js';

/**
 * `resolveProject` is the one door from a wire id back to a directory, and the
 * bus runs it before any SDK call — so it is tested against real directories,
 * the same way the allowlist it is built on is (wayfinder 05 §5).
 */
describe('resolveProject', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-discovery-');
    root = sandbox.root;
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  function discovery(projectsRoot: string | null = root) {
    return createProjectDiscovery(projectsRoot, { warn: () => undefined });
  }

  function idFor(candidate: string): string {
    return Buffer.from(candidate, 'utf8').toString('base64url');
  }

  it('decodes a listed id back to the same canonical project', async () => {
    await mkdir(path.join(root, 'alpha'));

    const [listed] = await discovery().listProjects();
    expect(listed).toBeDefined();

    const resolved = await discovery().resolveProject(listed?.id ?? '');

    expect(resolved).toEqual({
      id: listed?.id,
      name: 'alpha',
      path: await realpath(path.join(root, 'alpha')),
    });
  });

  it('rejects an id that decodes to a path outside the root', async () => {
    const outside = path.join(sandbox.dir, 'outside');
    await mkdir(outside);

    await expect(discovery().resolveProject(idFor(outside))).resolves.toBeNull();
  });

  it('rejects an id that decodes to a path that does not exist', async () => {
    await expect(discovery().resolveProject(idFor(path.join(root, 'ghost')))).resolves.toBeNull();
  });

  it('rejects an id that decodes to a file, not a directory', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'not a project');

    await expect(discovery().resolveProject(idFor(path.join(root, 'notes.txt')))).resolves.toBeNull();
  });

  it('rejects a malformed id without touching the filesystem', async () => {
    await expect(discovery().resolveProject('not!base64url')).resolves.toBeNull();
    await expect(discovery().resolveProject('')).resolves.toBeNull();
  });

  it('rejects every id when no projects root is configured', async () => {
    await mkdir(path.join(root, 'alpha'));
    const id = idFor(await realpath(path.join(root, 'alpha')));

    await expect(discovery(null).resolveProject(id)).resolves.toBeNull();
  });

  it('canonicalizes an in-root symlink id to its target directory', async () => {
    await mkdir(path.join(root, 'alpha'));
    await symlink(path.join(root, 'alpha'), path.join(root, 'alias'), linkType);
    // The listed id is the canonical target path, not the alias spelling.
    const [listed] = await discovery().listProjects();
    const aliasId = listed?.id ?? '';

    const resolved = await discovery().resolveProject(aliasId);

    expect(resolved?.path).toBe(await realpath(path.join(root, 'alpha')));
  });
});

/**
 * `createProject` is the root-level write (ticket 47): the one operation that
 * happens *above* a project rather than inside one, so it lives on discovery —
 * the only module that reads the projects root — and it is tested the same way,
 * against real directories.
 */
describe('createProject', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-create-');
    root = sandbox.root;
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  function discovery(projectsRoot: string | null = root) {
    return createProjectDiscovery(projectsRoot, { warn: () => undefined });
  }

  function idFor(candidate: string): string {
    return Buffer.from(candidate, 'utf8').toString('base64url');
  }

  it('creates the directory and answers the row a rescan would find', async () => {
    const created = await discovery().createProject('beta');
    const canonical = await realpath(path.join(root, 'beta'));

    expect(created).toEqual({
      status: 'ok',
      project: { id: idFor(canonical), name: 'beta', path: canonical },
    });

    // The same project, not a second copy of it: one row, one id.
    await expect(discovery().listProjects()).resolves.toEqual([
      { id: idFor(canonical), name: 'beta', path: canonical },
    ]);
  });

  it('refuses a name that is already taken, whatever is at it', async () => {
    await mkdir(path.join(root, 'taken'));
    await writeFile(path.join(root, 'notes.txt'), 'not a project');
    await symlink(path.join(root, 'taken'), path.join(root, 'alias'), linkType);

    // A directory, a file and a link are all merely in the way — nothing is
    // written *through* an entry here, so the drawer's `symlink` arm does not
    // apply and a link that resolves in-root is a legitimate project anyway.
    for (const name of ['taken', 'notes.txt', 'alias']) {
      await expect(discovery().createProject(name)).resolves.toEqual({ status: 'exists' });
    }

    expect((await lstat(path.join(root, 'notes.txt'))).isFile()).toBe(true);
    expect((await lstat(path.join(root, 'alias'))).isSymbolicLink()).toBe(true);
  });

  it('refuses anything that is not one clean, non-dot segment', async () => {
    const names = ['', '.', '..', '../x', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(256), '.hidden'];

    for (const name of names) {
      await expect(discovery().createProject(name)).resolves.toEqual({ status: 'invalid_name' });
    }

    // Not one of them reached the disk — the dot one included: discovery skips
    // dot-directories, so it would be a project the user could never see.
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('answers no_root when there is no usable projects root', async () => {
    // Unconfigured, absent, and not a directory: all three are "nowhere to
    // create", which is not the empty list `GET /projects` honestly answers
    // with. A root that is a plain file fails differently per platform
    // (`mkdir` says ENOENT on Windows and ENOTDIR elsewhere), so the same
    // expectation has to hold for both.
    const fileRoot = path.join(sandbox.dir, 'a-file');
    await writeFile(fileRoot, 'not a root');

    await expect(discovery(null).createProject('beta')).resolves.toEqual({ status: 'no_root' });
    await expect(
      discovery(path.join(sandbox.dir, 'not-there')).createProject('beta'),
    ).resolves.toEqual({ status: 'no_root' });
    await expect(discovery(fileRoot).createProject('beta')).resolves.toEqual({ status: 'no_root' });
  });
});
