import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAllowlist } from './allowlist.js';

/** Junctions need no elevation on Windows; real directory symlinks elsewhere. */
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * The allowlist is the security boundary (wayfinder 05 §5), so it is tested
 * against real directories on disk — `fs` is never mocked. The sandbox is
 * realpath'd first so its own symlinks (macOS `/var` → `/private/var`, Windows
 * 8.3 names) cannot make the expectations lie.
 */
describe('canonicalizeInsideRoot', () => {
  let sandbox: string;
  let root: string;

  beforeEach(async () => {
    sandbox = await realpath(await mkdtemp(path.join(tmpdir(), 'clodeck-allowlist-')));
    root = path.join(sandbox, 'projects');
    await mkdir(root);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('accepts a directory inside the root and returns its canonical path', async () => {
    const project = path.join(root, 'alpha');
    await mkdir(project);

    await expect(createAllowlist(root).canonicalizeInsideRoot(project)).resolves.toBe(
      await realpath(project),
    );
  });

  it('rejects a `..` traversal out of the root', async () => {
    const outside = path.join(sandbox, 'outside');
    await mkdir(outside);

    await expect(
      createAllowlist(root).canonicalizeInsideRoot(path.join(root, '..', 'outside')),
    ).resolves.toBeNull();
  });

  it('rejects a path that does not exist', async () => {
    await expect(
      createAllowlist(root).canonicalizeInsideRoot(path.join(root, 'ghost')),
    ).resolves.toBeNull();
  });

  it('canonicalizes a symlink that resolves inside the root to its target', async () => {
    const target = path.join(root, 'alpha');
    await mkdir(target);
    const link = path.join(root, 'alpha-link');
    await symlink(target, link, linkType);

    await expect(createAllowlist(root).canonicalizeInsideRoot(link)).resolves.toBe(await realpath(target));
  });

  it('rejects a symlink whose realpath escapes the root', async () => {
    const outside = path.join(sandbox, 'outside');
    await mkdir(outside);
    const link = path.join(root, 'escape');
    await symlink(outside, link, linkType);

    await expect(createAllowlist(root).canonicalizeInsideRoot(link)).resolves.toBeNull();
  });

  it('accepts a child whose name merely begins with dots', async () => {
    const dotted = path.join(root, '..config');
    await mkdir(dotted);

    await expect(createAllowlist(root).canonicalizeInsideRoot(dotted)).resolves.toBe(
      await realpath(dotted),
    );
  });
});
