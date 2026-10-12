import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSandbox, linkType, removeSandbox, type Sandbox } from '../test-support.js';
import {
  createScopedFs,
  name,
  type FileName,
  type ScopedPath,
  type WriteTarget,
} from './scoped-fs.js';

const win32 = process.platform === 'win32';

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

/**
 * The writer is exercised the same way: real temp directories, no `fs` mock, and
 * the seam under test is the *door* — a raw relative string in, a `WriteTarget`
 * (or a rejection) out. The symlink-in-window guards are POSIX-only, the suite's
 * one sanctioned skip.
 */
describe('ScopedFs (write half)', () => {
  let sandbox: Sandbox;
  let proj: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-fs-write-');
    await mkdir(path.join(sandbox.root, 'proj'));
    proj = await realpath(path.join(sandbox.root, 'proj'));
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  const fs = () => createScopedFs(proj);

  /** Reach the write functions through `resolveWriteTarget` — the fence under test. */
  async function writeTarget(rel: string): Promise<WriteTarget> {
    const result = await fs().resolveWriteTarget(rel);
    if (result.status !== 'ok') throw new Error(`resolveWriteTarget(${rel}) → ${result.status}`);
    return result.target;
  }

  function fileName(input: string): FileName {
    const result = name(input);
    if (result === null) throw new Error(`name(${input}) → null`);
    return result;
  }

  describe('name', () => {
    it('accepts a plain single segment', () => {
      expect(name('index.ts')).toBe('index.ts');
    });

    it('rejects separators, dot segments, NUL, empty, and over-length', () => {
      expect(name('')).toBeNull();
      expect(name('.')).toBeNull();
      expect(name('..')).toBeNull();
      expect(name('a/b')).toBeNull();
      expect(name('a\\b')).toBeNull();
      expect(name('bad\0name')).toBeNull();
      expect(name('x'.repeat(256))).toBeNull();
    });
  });

  describe('resolveWriteTarget', () => {
    it('reports the empty path as the root', async () => {
      expect(await fs().resolveWriteTarget('')).toEqual({ status: 'is_root' });
    });

    it('scopes the parent to the root and the basename for a top-level entry', async () => {
      const result = await fs().resolveWriteTarget('a.txt');

      expect(result).toEqual({ status: 'ok', target: { parent: proj, name: 'a.txt' } });
    });

    it('reports a missing parent as not_found', async () => {
      expect(await fs().resolveWriteTarget('missing/a.txt')).toEqual({ status: 'not_found' });
    });

    it('reports a parent that is a file as not_a_directory', async () => {
      await writeFile(path.join(proj, 'f.txt'), 'x');

      expect(await fs().resolveWriteTarget('f.txt/x')).toEqual({ status: 'not_a_directory' });
    });

    it('reports an escaping parent as outside_root', async () => {
      expect(await fs().resolveWriteTarget('../a.txt')).toEqual({ status: 'outside_root' });
    });

    it('reports a basename that is not a single segment as invalid_name', async () => {
      await mkdir(path.join(proj, 'leaf'));

      expect(await fs().resolveWriteTarget('leaf/..')).toEqual({ status: 'invalid_name' });
    });

    it('reports a NUL basename as invalid_name', async () => {
      expect(name('a\0b')).toBeNull();
      expect(await fs().resolveWriteTarget('a\0b')).toEqual({ status: 'invalid_name' });
    });
  });

  describe('createFile', () => {
    it('creates a file holding the given bytes', async () => {
      const target = await writeTarget('a.txt');

      expect(await fs().createFile(target, Buffer.from('hello'))).toEqual({ status: 'ok' });
      expect(await readFile(path.join(proj, 'a.txt'), 'utf8')).toBe('hello');
    });

    it('refuses to overwrite an existing file', async () => {
      await writeFile(path.join(proj, 'a.txt'), 'first');
      const target = await writeTarget('a.txt');

      expect(await fs().createFile(target, Buffer.from('second'))).toEqual({ status: 'exists' });
      expect(await readFile(path.join(proj, 'a.txt'), 'utf8')).toBe('first');
    });

    it.skipIf(win32)('refuses a symlink in the final segment and never escapes', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'link'), linkType);
      const target = await writeTarget('link');

      expect(await fs().createFile(target, Buffer.from('x'))).toEqual({ status: 'symlink' });
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
    });
  });

  describe('createDirectory', () => {
    it('creates a directory', async () => {
      const target = await writeTarget('sub');

      expect(await fs().createDirectory(target)).toEqual({ status: 'ok' });
      expect((await lstat(path.join(proj, 'sub'))).isDirectory()).toBe(true);
    });

    it('refuses to create over an existing entry', async () => {
      await mkdir(path.join(proj, 'sub'));
      const target = await writeTarget('sub');

      expect(await fs().createDirectory(target)).toEqual({ status: 'exists' });
    });

    it.skipIf(win32)('refuses a symlink in the final segment and never escapes', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'link'), linkType);
      const target = await writeTarget('link');

      expect(await fs().createDirectory(target)).toEqual({ status: 'symlink' });
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
    });
  });

  describe('overwriteFile', () => {
    it('overwrites an existing file with the new bytes', async () => {
      await writeFile(path.join(proj, 'a.txt'), 'first');
      const target = await writeTarget('a.txt');

      expect(await fs().overwriteFile(target, Buffer.from('second'))).toEqual({ status: 'ok' });
      expect(await readFile(path.join(proj, 'a.txt'), 'utf8')).toBe('second');
    });

    it('reports a missing file as not_found and creates nothing', async () => {
      const target = await writeTarget('nope.txt');

      expect(await fs().overwriteFile(target, Buffer.from('x'))).toEqual({ status: 'not_found' });
      await expect(lstat(path.join(proj, 'nope.txt'))).rejects.toThrow();
    });

    it('refuses a directory target as not_a_file', async () => {
      await mkdir(path.join(proj, 'sub'));
      const target = await writeTarget('sub');

      expect(await fs().overwriteFile(target, Buffer.from('x'))).toEqual({ status: 'not_a_file' });
      expect((await lstat(path.join(proj, 'sub'))).isDirectory()).toBe(true);
    });

    it.skipIf(win32)('refuses a symlink in the final segment and never escapes', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'link'), linkType);
      const target = await writeTarget('link');

      expect(await fs().overwriteFile(target, Buffer.from('x'))).toEqual({ status: 'symlink' });
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
    });
  });

  describe('rename', () => {
    it('renames an entry in place', async () => {
      await writeFile(path.join(proj, 'old.txt'), 'x');
      const target = await writeTarget('old.txt');

      expect(await fs().rename(target, fileName('new.txt'))).toEqual({ status: 'ok' });
      expect(await readFile(path.join(proj, 'new.txt'), 'utf8')).toBe('x');
      await expect(lstat(path.join(proj, 'old.txt'))).rejects.toThrow();
    });

    it('reports a missing source as not_found', async () => {
      const target = await writeTarget('nope.txt');

      expect(await fs().rename(target, fileName('other.txt'))).toEqual({ status: 'not_found' });
    });
  });

  /**
   * A move takes a source entry and a *destination directory* — the
   * cross-directory operation `rename` deliberately leaves alone. The two ends
   * arrive from different doors (`resolveWriteTarget` for the entry, `resolve`
   * for the directory), and every refusal below is one of those doors' answers or
   * the move's own: an entry already there, and a folder into its own subtree.
   */
  describe('move', () => {
    /** Reach a directory the way a route does — through the reader's door. */
    async function destDir(rel: string): Promise<ScopedPath> {
      const result = await fs().resolve(rel);
      if (result.status !== 'ok') throw new Error(`resolve(${rel}) → ${result.status}`);
      return result.scoped;
    }

    it('moves a file into another directory, keeping its name', async () => {
      await mkdir(path.join(proj, 'src'));
      await writeFile(path.join(proj, 'a.txt'), 'data');
      const source = await writeTarget('a.txt');

      expect(await fs().move(source, await destDir('src'))).toEqual({ status: 'ok' });
      expect(await readFile(path.join(proj, 'src', 'a.txt'), 'utf8')).toBe('data');
      await expect(lstat(path.join(proj, 'a.txt'))).rejects.toThrow();
    });

    it('moves a file back out to the root', async () => {
      await mkdir(path.join(proj, 'src'));
      await writeFile(path.join(proj, 'src', 'a.txt'), 'data');
      const source = await writeTarget('src/a.txt');

      expect(await fs().move(source, await destDir(''))).toEqual({ status: 'ok' });
      expect(await readFile(path.join(proj, 'a.txt'), 'utf8')).toBe('data');
    });

    it('moves a directory with everything inside it', async () => {
      await mkdir(path.join(proj, 'dest'));
      await mkdir(path.join(proj, 'src'));
      await mkdir(path.join(proj, 'src', 'inner'));
      await writeFile(path.join(proj, 'src', 'inner', 'deep.txt'), 'data');
      const source = await writeTarget('src');

      expect(await fs().move(source, await destDir('dest'))).toEqual({ status: 'ok' });
      expect(await readFile(path.join(proj, 'dest', 'src', 'inner', 'deep.txt'), 'utf8')).toBe('data');
      await expect(lstat(path.join(proj, 'src'))).rejects.toThrow();
    });

    it('reports a missing source as not_found and leaves the destination empty', async () => {
      await mkdir(path.join(proj, 'src'));
      const source = await writeTarget('gone.txt');

      expect(await fs().move(source, await destDir('src'))).toEqual({ status: 'not_found' });
      expect(await readdir(path.join(proj, 'src'))).toEqual([]);
    });

    it('reports a destination that is a file as not_a_directory', async () => {
      await writeFile(path.join(proj, 'a.txt'), 'data');
      await writeFile(path.join(proj, 'f.txt'), 'x');
      const source = await writeTarget('a.txt');

      expect(await fs().move(source, await destDir('f.txt'))).toEqual({ status: 'not_a_directory' });
      expect(await readFile(path.join(proj, 'a.txt'), 'utf8')).toBe('data');
    });

    it('refuses a move into the directory the entry already lives in', async () => {
      await mkdir(path.join(proj, 'src'));
      await writeFile(path.join(proj, 'src', 'a.txt'), 'data');
      const source = await writeTarget('src/a.txt');

      expect(await fs().move(source, await destDir('src'))).toEqual({ status: 'same_directory' });
      expect(await readFile(path.join(proj, 'src', 'a.txt'), 'utf8')).toBe('data');
    });

    it('refuses a name collision rather than overwriting it', async () => {
      await mkdir(path.join(proj, 'src'));
      await writeFile(path.join(proj, 'a.txt'), 'the source');
      await writeFile(path.join(proj, 'src', 'a.txt'), 'the one already there');
      const source = await writeTarget('a.txt');

      expect(await fs().move(source, await destDir('src'))).toEqual({ status: 'exists' });
      expect(await readFile(path.join(proj, 'a.txt'), 'utf8')).toBe('the source');
      expect(await readFile(path.join(proj, 'src', 'a.txt'), 'utf8')).toBe('the one already there');
    });

    it('refuses a folder into itself, or into its own subtree', async () => {
      await mkdir(path.join(proj, 'src'));
      await mkdir(path.join(proj, 'src', 'nested'));
      const source = await writeTarget('src');

      expect(await fs().move(source, await destDir('src'))).toEqual({ status: 'into_own_descendant' });
      expect(await fs().move(source, await destDir('src/nested'))).toEqual({ status: 'into_own_descendant' });
      expect((await lstat(path.join(proj, 'src', 'nested'))).isDirectory()).toBe(true);
    });

    it('never mints a destination behind a symlink that leaves the root', async () => {
      // The destination's door, which is the reader's: a link out of the root is
      // not a directory inside it, so no `ScopedPath` exists to move into.
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'link'), linkType);

      await expect(fs().resolve('link')).resolves.toEqual({ status: 'outside_root' });
    });

    it.skipIf(win32)('refuses a symlink as the source, and never moves what it points at', async () => {
      await mkdir(path.join(proj, 'src'));
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'link'), linkType);
      const source = await writeTarget('link');

      expect(await fs().move(source, await destDir('src'))).toEqual({ status: 'symlink' });
      expect((await lstat(path.join(proj, 'link'))).isSymbolicLink()).toBe(true);
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
    });
  });

  describe('remove', () => {
    it('removes a file', async () => {
      await writeFile(path.join(proj, 'gone.txt'), 'x');
      const target = await writeTarget('gone.txt');

      expect(await fs().remove(target)).toEqual({ status: 'ok' });
      await expect(lstat(path.join(proj, 'gone.txt'))).rejects.toThrow();
    });

    it('removes a directory with its contents', async () => {
      await mkdir(path.join(proj, 'sub'));
      await writeFile(path.join(proj, 'sub', 'inner.txt'), 'x');
      const target = await writeTarget('sub');

      expect(await fs().remove(target)).toEqual({ status: 'ok' });
      await expect(lstat(path.join(proj, 'sub'))).rejects.toThrow();
    });

    it('reports a missing entry as not_found', async () => {
      const target = await writeTarget('nope.txt');

      expect(await fs().remove(target)).toEqual({ status: 'not_found' });
    });

    it.skipIf(win32)('removes the link itself, not its target', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(proj, 'link'), linkType);
      const target = await writeTarget('link');

      expect(await fs().remove(target)).toEqual({ status: 'ok' });
      await expect(lstat(path.join(proj, 'link'))).rejects.toThrow();
      expect((await lstat(path.join(sandbox.dir, 'outside'))).isDirectory()).toBe(true);
    });
  });

  describe('the root is unreachable', () => {
    it('never mints a source for the empty path, so a move cannot take the project itself', async () => {
      expect(await fs().resolveWriteTarget('')).toEqual({ status: 'is_root' });
      expect((await lstat(proj)).isDirectory()).toBe(true);
    });

    it('never mints a target for the empty path, so remove/rename cannot touch the root', async () => {
      // `resolveWriteTarget('')` is `is_root`, so no `WriteTarget` exists for the
      // root — and every write op joins `parent`/`name`, so it can only ever
      // name a *child* of its parent. The root is unreachable by construction.
      expect(await fs().resolveWriteTarget('')).toEqual({ status: 'is_root' });
      expect((await lstat(proj)).isDirectory()).toBe(true);
    });
  });

  describe('no escape', () => {
    it('never creates outside the root through a traversal', async () => {
      const result = await fs().resolveWriteTarget('../escape.txt');

      expect(result).toEqual({ status: 'outside_root' });
      await expect(lstat(path.join(sandbox.dir, 'escape.txt'))).rejects.toThrow();
    });

    it('never creates outside the root through an absolute path', async () => {
      const outside = path.join(sandbox.dir, 'abs.txt');
      const result = await fs().resolveWriteTarget(outside);

      expect(result.status).not.toBe('ok');
      await expect(lstat(outside)).rejects.toThrow();
    });
  });
});
