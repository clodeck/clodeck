import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
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

/**
 * `deleteProject` is the one destructive root-level operation (ticket 89), so it
 * is pinned against real directories: what leaves the disk, and — more
 * importantly — everything the scan refuses to remove. The rule is decision 87's
 * D6: exactly one root entry canonicalizing to the id, and that entry a real
 * directory.
 */
describe('deleteProject', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-delete-');
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

  it('removes the directory recursively and leaves the root itself in place', async () => {
    await mkdir(path.join(root, 'alpha', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'alpha', 'nested', 'notes.txt'), 'gone');
    const canonical = await realpath(path.join(root, 'alpha'));

    await expect(discovery().deleteProject(idFor(canonical))).resolves.toEqual({ status: 'ok' });

    await expect(lstat(path.join(root, 'alpha'))).rejects.toMatchObject({ code: 'ENOENT' });
    // The root is the allowlist, not a project: it is still there, empty.
    await expect(lstat(root)).resolves.toBeDefined();
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('refuses an ambiguous id and removes neither the link nor its target', async () => {
    // The row the scan lists for `zulu` can be the link `alpha`, and the link is
    // also a root entry — so one canonical path has two labels. Deleting by id
    // would destroy the target while the label named the link (D6).
    await mkdir(path.join(root, 'zulu'));
    await writeFile(path.join(root, 'zulu', 'notes.txt'), 'keep me');
    await symlink(path.join(root, 'zulu'), path.join(root, 'alpha'), linkType);
    const canonical = await realpath(path.join(root, 'zulu'));

    await expect(discovery().deleteProject(idFor(canonical))).resolves.toEqual({
      status: 'symlink',
    });

    await expect(readFile(path.join(root, 'zulu', 'notes.txt'), 'utf8')).resolves.toBe('keep me');
    expect((await lstat(path.join(root, 'alpha'))).isSymbolicLink()).toBe(true);
  });

  it('refuses the root itself, and nothing outside the root is touched', async () => {
    const outside = path.join(sandbox.dir, 'outside');
    await mkdir(outside);
    await mkdir(path.join(root, 'alpha'));

    await expect(discovery().deleteProject(idFor(await realpath(root)))).resolves.toEqual({
      status: 'not_found',
    });
    await expect(discovery().deleteProject(idFor(await realpath(outside)))).resolves.toEqual({
      status: 'not_found',
    });

    // The allowlist still holds on both sides of the boundary.
    await expect(lstat(root)).resolves.toBeDefined();
    await expect(lstat(path.join(root, 'alpha'))).resolves.toBeDefined();
    await expect(lstat(outside)).resolves.toBeDefined();
  });

  it('refuses a nested directory: a project is an immediate child of the root', async () => {
    await mkdir(path.join(root, 'alpha', 'nested'), { recursive: true });
    const nested = await realpath(path.join(root, 'alpha', 'nested'));

    await expect(discovery().deleteProject(idFor(nested))).resolves.toEqual({
      status: 'not_found',
    });
    await expect(lstat(nested)).resolves.toBeDefined();
  });

  it('answers not_found for every id that does not resolve to a project directory', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'not a project');

    for (const candidate of [
      path.join(root, 'ghost'),
      path.join(root, 'notes.txt'),
      path.join(sandbox.dir, 'outside'),
      '',
    ]) {
      await expect(
        discovery().deleteProject(candidate === '' ? candidate : idFor(candidate)),
      ).resolves.toEqual({ status: 'not_found' });
    }

    await expect(discovery().deleteProject('not!base64url')).resolves.toEqual({
      status: 'not_found',
    });
    await expect(readFile(path.join(root, 'notes.txt'), 'utf8')).resolves.toBe('not a project');
  });

  it('answers not_found when no projects root is configured', async () => {
    const id = idFor(await realpath(root));

    await expect(discovery(null).deleteProject(id)).resolves.toEqual({ status: 'not_found' });
    await expect(lstat(root)).resolves.toBeDefined();
  });
});
