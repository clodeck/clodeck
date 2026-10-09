import { mkdir, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAllowlist } from './allowlist.js';
import { createSandbox, linkType, removeSandbox, type Sandbox } from './test-support.js';

/**
 * The allowlist is the security boundary (wayfinder 05 §5), so it is tested
 * against real directories on disk — `fs` is never mocked.
 */
describe('canonicalizeInsideRoot', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-allowlist-');
    root = sandbox.root;
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  it('accepts a directory inside the root and returns its canonical path', async () => {
    const project = path.join(root, 'alpha');
    await mkdir(project);

    await expect(createAllowlist(root).canonicalizeInsideRoot(project)).resolves.toBe(
      await realpath(project),
    );
  });

  it('rejects a `..` traversal out of the root', async () => {
    const outside = path.join(sandbox.dir, 'outside');
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
    const outside = path.join(sandbox.dir, 'outside');
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
