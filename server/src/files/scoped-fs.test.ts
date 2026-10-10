import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSandbox, linkType, removeSandbox, type Sandbox } from '../test-support.js';
import { createScopedFs, type ScopedPath } from './scoped-fs.js';

/**
 * The reader is exercised against real temp directories — no `fs` mocking —
 * exactly like `discovery.test.ts`. The seam under test is the *boundary*: a
 * raw relative string in, a `ScopedPath` (or a rejection) out.
 */
describe('ScopedFs (read half)', () => {
  let sandbox: Sandbox;
  let proj: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-fs-');
    await mkdir(path.join(sandbox.root, 'proj'));
    proj = await realpath(path.join(sandbox.root, 'proj'));
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  const fs = () => createScopedFs(proj);

  /** Reach the read functions through `resolve` — the fence under test. */
  async function resolveScoped(rel: string): Promise<ScopedPath> {
    const result = await fs().resolve(rel);
    if (result.status !== 'ok') throw new Error(`resolve(${rel}) → ${result.status}`);
    return result.scoped;
  }

  describe('resolve', () => {
    it('resolves the root itself to a directory', async () => {
      const result = await fs().resolve('');

      expect(result).toEqual({ status: 'ok', scoped: proj, kind: 'directory' });
    });

    it('resolves a nested file and directory to their kinds', async () => {
      await mkdir(path.join(proj, 'src'));
      await writeFile(path.join(proj, 'src', 'index.ts'), 'export {}');

      expect(await fs().resolve('src')).toMatchObject({ status: 'ok', kind: 'directory' });
      expect(await fs().resolve('src/index.ts')).toMatchObject({ status: 'ok', kind: 'file' });
    });

    it('reports a missing path as not_found', async () => {
      expect(await fs().resolve('nope')).toEqual({ status: 'not_found' });
    });

    it('reports a traversal as outside_root, not not_found', async () => {
      // `..` exists (the projects root) — it is a *real* path, just outside.
      expect(await fs().resolve('..')).toEqual({ status: 'outside_root' });
    });
  });

  describe('listDir', () => {
    it('lists directories before files, by name, with size and mtime on files', async () => {
      await mkdir(path.join(proj, 'zeta'));
      await mkdir(path.join(proj, 'alpha'));
      await writeFile(path.join(proj, 'b.txt'), 'bb');
      await writeFile(path.join(proj, 'a.txt'), 'a');

      const entries = await fs().listDir(await resolveScoped(''));

      expect(entries.map((e) => e.type)).toEqual(['directory', 'directory', 'file', 'file']);
      expect(entries.map((e) => e.name)).toEqual(['alpha', 'zeta', 'a.txt', 'b.txt']);
      expect(entries[2]).toMatchObject({ type: 'file', name: 'a.txt', size: 1 });
      expect((entries[2] as { mtime: string }).mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('follows a symlink that stays inside the root', async () => {
      await mkdir(path.join(proj, 'real'));
      await symlink(path.join(proj, 'real'), path.join(proj, 'link'), linkType);

      const entries = await fs().listDir(await resolveScoped(''));

      expect(entries.map((e) => e.name)).toEqual(['link', 'real']);
      expect(entries.map((e) => e.type)).toEqual(['directory', 'directory']);
    });

    it('lists an escaping symlink as non-navigable', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'escape'), linkType);

      const entries = await fs().listDir(await resolveScoped(''));

      expect(entries).toEqual([{ type: 'symlink', name: 'escape' }]);
    });

    it('lists a broken symlink as non-navigable', async () => {
      await symlink(path.join(proj, 'nope'), path.join(proj, 'broken'), linkType);

      const entries = await fs().listDir(await resolveScoped(''));

      expect(entries).toEqual([{ type: 'symlink', name: 'broken' }]);
    });
  });

  describe('readFile', () => {
    it('returns text content with size and no truncation', async () => {
      await writeFile(path.join(proj, 'a.txt'), 'hello world');

      const content = await fs().readFile(await resolveScoped('a.txt'));

      expect(content).toEqual({ kind: 'text', content: 'hello world', truncated: false, size: 11 });
    });

    it('classifies a NUL byte as binary', async () => {
      await writeFile(path.join(proj, 'blob'), Buffer.from([0x00, 0x01, 0x02]));

      expect(await fs().readFile(await resolveScoped('blob'))).toEqual({ kind: 'binary', size: 3 });
    });

    it('classifies invalid UTF-8 as binary', async () => {
      await writeFile(path.join(proj, 'bad'), Buffer.from([0xff, 0xfe, 0xfd]));

      expect(await fs().readFile(await resolveScoped('bad'))).toEqual({ kind: 'binary', size: 3 });
    });

    it('truncates text larger than the cap and flags it', async () => {
      await writeFile(path.join(proj, 'big.txt'), 'x'.repeat(300 * 1024));

      const content = await fs().readFile(await resolveScoped('big.txt'));

      expect(content).toMatchObject({ kind: 'text', truncated: true, size: 300 * 1024 });
      expect((content as { content: string }).content).toHaveLength(256 * 1024);
    });
  });
});
