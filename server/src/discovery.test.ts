import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
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
