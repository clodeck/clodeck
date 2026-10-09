import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The fixture the server's suites share: a throwaway sandbox with a `projects`
 * root inside it. The sandbox is `realpath`'d first, so its own symlinks
 * (macOS `/var` → `/private/var`, Windows 8.3 names) cannot make expectations
 * lie.
 *
 * Test support, not package code — `tsconfig.build.json` keeps it out of `dist`.
 */

/** Junctions need no elevation on Windows; real directory symlinks elsewhere. */
export const linkType = process.platform === 'win32' ? 'junction' : 'dir';

export interface Sandbox {
  /** The realpath'd temp directory. Fixtures that must stay *outside* the root live here. */
  dir: string;
  /** The projects root, created inside `dir`. */
  root: string;
}

export async function createSandbox(prefix = 'clodeck-test-'): Promise<Sandbox> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  const root = path.join(dir, 'projects');
  await mkdir(root);

  return { dir, root };
}

export async function removeSandbox(sandbox: Sandbox): Promise<void> {
  await rm(sandbox.dir, { recursive: true, force: true });
}
