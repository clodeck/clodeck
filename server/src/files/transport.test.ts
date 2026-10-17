import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { MAX_UPLOAD_BYTES, type FileContent, type FileEntry } from '@clodeck/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromBuffer, type Entry } from 'yauzl';

import { createProjectDiscovery } from '../discovery.js';
import {
  createSandbox,
  createTestApp,
  linkType,
  login,
  removeSandbox,
  type Sandbox,
} from '../test-support.js';

const win32 = process.platform === 'win32';

/**
 * One authenticated request. Every route in this suite sits behind the gate, so
 * the session cookie belongs to the request's *shape* rather than to a line each
 * assertion repeats — and the login is the real route, because the gate has no
 * bypass to reach for.
 */
async function authed(app: FastifyInstance, options: InjectOptions): Promise<LightMyRequestResponse> {
  return app.inject({ ...options, headers: { ...options.headers, cookie: await login(app) } });
}

/**
 * A zip response, unpacked into `entry name → bytes` (a directory entry maps to
 * an empty buffer). The archive route streams from yazl, so reading it back with
 * the matching reader is the only way to assert what a client would actually
 * unzip — names, structure, the UTF-8 flag and the bytes all at once.
 */
function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error !== null) {
        reject(error);
        return;
      }

      const entries = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('end', () => { resolve(entries); });
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName.endsWith('/')) {
          entries.set(entry.fileName, Buffer.alloc(0));
          zip.readEntry();
          return;
        }

        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError !== null) {
            reject(streamError);
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => { chunks.push(chunk); });
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * The read endpoints, pinned at the HTTP boundary: real route handler, real
 * filesystem, real temp projects root — no `fs` mocking. `app.inject()` boots
 * the handler without a socket (the same seam `app.test.ts` uses).
 */
describe('the file read routes', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-files-');
    root = sandbox.root;
    apps = [];
    await mkdir(path.join(root, 'proj'));
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(): FastifyInstance {
    const app = createTestApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
    });
    apps.push(app);
    return app;
  }

  async function id(name: string): Promise<string> {
    return Buffer.from(await realpath(path.join(root, name)), 'utf8').toString('base64url');
  }

  it('lists the root directory — dirs before files, by name', async () => {
    await mkdir(path.join(root, 'proj', 'zeta'));
    await mkdir(path.join(root, 'proj', 'alpha'));
    await writeFile(path.join(root, 'proj', 'a.txt'), 'a');

    const response = await authed(makeApp(), { method: 'GET', url: `/api/projects/${await id('proj')}/files` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { entries: FileEntry[] };
    expect(Object.keys(body)).toEqual(['entries']);
    expect(body.entries.map((entry) => entry.name)).toEqual(['alpha', 'zeta', 'a.txt']);
  });

  it('lists a nested directory through ?path=', async () => {
    await mkdir(path.join(root, 'proj', 'sub'));
    await writeFile(path.join(root, 'proj', 'sub', 'inner.txt'), 'x');

    const response = await authed(makeApp(), {
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files?path=sub`,
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { entries: FileEntry[] }).entries.map((entry) => entry.name)).toEqual(['inner.txt']);
  });

  it('serves a text file and flags a truncated one', async () => {
    await writeFile(path.join(root, 'proj', 'small.txt'), 'hello');
    await writeFile(path.join(root, 'proj', 'big.txt'), 'x'.repeat(300 * 1024));
    const app = makeApp();

    const small = await authed(app, {
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files/content?path=small.txt`,
    });
    expect(small.statusCode).toBe(200);
    expect(small.json()).toEqual({
      content: { kind: 'text', content: 'hello', truncated: false, size: 5 },
    });

    const big = await authed(app, {
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files/content?path=big.txt`,
    });
    expect((big.json() as { content: FileContent }).content).toMatchObject({ kind: 'text', truncated: true });
  });

  it('serves binary as 200 with kind binary, not an error', async () => {
    await writeFile(path.join(root, 'proj', 'blob'), Buffer.from([0x00, 0x01]));

    const response = await authed(makeApp(), {
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files/content?path=blob`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ content: { kind: 'binary', size: 2 } });
  });

  it('rejects a traversal, an absolute path, and a NUL with 400', async () => {
    const app = makeApp();
    const pid = await id('proj');

    const traversal = await authed(app, { method: 'GET', url: `/api/projects/${pid}/files?path=..` });
    expect(traversal.statusCode).toBe(400);

    const absolute = await authed(app, { method: 'GET', url: `/api/projects/${pid}/files?path=${encodeURIComponent('/etc')}` });
    expect(absolute.statusCode).toBe(400);

    const nul = await authed(app, {
      method: 'GET',
      url: `/api/projects/${pid}/files?path=${encodeURIComponent('\0')}`,
    });
    expect(nul.statusCode).toBe(400);
  });

  it('returns 404 for an unknown project', async () => {
    const response = await authed(makeApp(), { method: 'GET', url: '/api/projects/not-a-project/files' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when the path is the wrong kind for the endpoint', async () => {
    await mkdir(path.join(root, 'proj', 'dir'));
    await writeFile(path.join(root, 'proj', 'file.txt'), 'x');
    const app = makeApp();
    const pid = await id('proj');

    const listOnFile = await authed(app, { method: 'GET', url: `/api/projects/${pid}/files?path=file.txt` });
    expect(listOnFile.statusCode).toBe(400);

    const contentOnDir = await authed(app, { method: 'GET', url: `/api/projects/${pid}/files/content?path=dir` });
    expect(contentOnDir.statusCode).toBe(400);
  });

  it('returns 404 when the path resolves outside the root through a symlink', async () => {
    await mkdir(path.join(sandbox.dir, 'outside'));
    await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'escape'), linkType);

    const response = await authed(makeApp(), {
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files?path=escape`,
    });

    expect(response.statusCode).toBe(404);
  });

  /**
   * The download route (ticket 42): the read side's guards exactly, but the
   * bytes as they are on disk — not the truncated text window `content` returns,
   * and not a `Blob` built from what the browser happens to be showing.
   */
  describe('download', () => {
    async function download(query: string): Promise<LightMyRequestResponse> {
      return authed(makeApp(), {
        method: 'GET',
        url: `/api/projects/${await id('proj')}/files/download?path=${encodeURIComponent(query)}`,
      });
    }

    it('serves a file as it is on disk, as an attachment under its own name', async () => {
      await writeFile(path.join(root, 'proj', 'report.txt'), 'the bytes, as written');

      const response = await download('report.txt');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="report.txt"; filename*=UTF-8''report.txt`,
      );
      expect(response.rawPayload.toString('utf8')).toBe('the bytes, as written');
    });

    it('escapes a non-ASCII name in the disposition so the file keeps its name', async () => {
      await writeFile(path.join(root, 'proj', 'تست.md'), 'hello');

      const response = await download('تست.md');

      expect(response.statusCode).toBe(200);
      // The RFC 5987 form carries the real name; the plain `filename` is the
      // ASCII fallback a client that ignores it would use.
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="___.md"; filename*=UTF-8''%D8%AA%D8%B3%D8%AA.md`,
      );
      expect(response.rawPayload.toString('utf8')).toBe('hello');
    });

    it('serves the whole file, past the window a text read truncates at', async () => {
      // The reader's text cap is 256 KiB; a download is not a read of a preview.
      const whole = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(path.join(root, 'proj', 'big.txt'), whole);

      const response = await download('big.txt');

      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toHaveLength(whole.length);
      expect(response.rawPayload.equals(whole)).toBe(true);
    });

    it('refuses a missing entry, the root, and a bad path; an unknown project is a 404', async () => {
      const app = makeApp();
      const pid = await id('proj');
      const url = (path: string): string =>
        `/api/projects/${pid}/files/download?path=${encodeURIComponent(path)}`;

      expect((await authed(app, { method: 'GET', url: url('gone.txt') })).statusCode).toBe(404);
      // The root is never downloaded, whatever its contents.
      expect((await authed(app, { method: 'GET', url: url('') })).statusCode).toBe(400);
      expect((await authed(app, { method: 'GET', url: url('..') })).statusCode).toBe(400);
      expect((await authed(app, { method: 'GET', url: url('/etc') })).statusCode).toBe(400);
      expect(
        (await authed(app, { method: 'GET', url: '/api/projects/not-a-project/files/download?path=x' }))
          .statusCode,
      ).toBe(404);
    });

    it('serves a directory as <name>.zip with the folder as its one top-level entry', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await mkdir(path.join(root, 'proj', 'src', 'empty'));
      await mkdir(path.join(root, 'proj', 'src', 'nested'));
      await writeFile(path.join(root, 'proj', 'src', 'a.txt'), 'alpha');
      await writeFile(path.join(root, 'proj', 'src', 'nested', 'b.txt'), 'beta');
      // Past the text reader's 256 KiB window: a zip is bytes, not a preview.
      const big = Buffer.alloc(300 * 1024, 0x61);
      await writeFile(path.join(root, 'proj', 'src', 'big.bin'), big);

      const response = await download('src');

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/zip');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="src.zip"; filename*=UTF-8''src.zip`,
      );

      const entries = await readZip(response.rawPayload);
      expect([...entries.keys()].sort()).toEqual([
        'src/',
        'src/a.txt',
        'src/big.bin',
        'src/empty/',
        'src/nested/',
        'src/nested/b.txt',
      ]);
      // The round trip: names are relative and clean, and the bytes are the
      // file's own — the empty folder and the large file included.
      for (const name of entries.keys()) {
        expect(name.startsWith('/')).toBe(false);
        expect(name.split('/')).not.toContain('..');
      }
      expect(entries.get('src/a.txt')?.toString('utf8')).toBe('alpha');
      expect(entries.get('src/nested/b.txt')?.toString('utf8')).toBe('beta');
      expect(entries.get('src/big.bin')?.equals(big)).toBe(true);
    });

    it('keeps a non-ASCII folder and file name as they are', async () => {
      const folder = 'پروژه';
      const file = 'یادداشت.md';
      await mkdir(path.join(root, 'proj', folder));
      await writeFile(path.join(root, 'proj', folder, file), 'متن');

      const response = await download(folder);

      expect(response.statusCode).toBe(200);
      // The disposition carries the real name percent-encoded, RFC 5987's form.
      expect(response.headers['content-disposition']).toContain(
        `filename*=UTF-8''${encodeURIComponent(`${folder}.zip`)}`,
      );

      const entries = await readZip(response.rawPayload);
      expect([...entries.keys()].sort()).toEqual([`${folder}/`, `${folder}/${file}`]);
      expect(entries.get(`${folder}/${file}`)?.toString('utf8')).toBe('متن');
    });

    it.skipIf(win32)('skips a symlink that leaves the root and archives an in-root one as its target', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await mkdir(path.join(root, 'proj', 'src', 'real-dir'));
      await writeFile(path.join(root, 'proj', 'src', 'real-dir', 'inside.txt'), 'inside');
      await writeFile(path.join(root, 'proj', 'src', 'real.txt'), 'real bytes');
      await mkdir(path.join(sandbox.dir, 'outside'));
      await writeFile(path.join(sandbox.dir, 'outside', 'secret.txt'), 'not yours');

      await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'src', 'escape'), linkType);
      await symlink(path.join(root, 'proj', 'src', 'real.txt'), path.join(root, 'proj', 'src', 'alias.txt'), linkType);
      await symlink(path.join(root, 'proj', 'src', 'real-dir'), path.join(root, 'proj', 'src', 'alias-dir'), linkType);

      const entries = await readZip((await download('src')).rawPayload);

      // The escaping link is neither followed nor included, under either name.
      expect([...entries.keys()].some((name) => name.includes('escape'))).toBe(false);
      expect([...entries.values()].some((bytes) => bytes.toString('utf8').includes('not yours'))).toBe(false);
      // An in-root link is the real thing, by its own entry name.
      expect(entries.get('src/alias.txt')?.toString('utf8')).toBe('real bytes');
      expect(entries.get('src/alias-dir/inside.txt')?.toString('utf8')).toBe('inside');
    });

    it('never serves a file behind a symlink that leaves the root', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await writeFile(path.join(sandbox.dir, 'outside', 'secret.txt'), 'not yours');
      await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'escape'), linkType);

      const response = await download('escape/secret.txt');

      expect(response.statusCode).toBe(404);
      expect(response.rawPayload.toString('utf8')).not.toContain('not yours');
    });
  });
});

/**
 * The write endpoints, pinned at the same seam as the reads: real route handler,
 * real filesystem, real temp projects root. Every happy path asserts both the
 * status code *and* that the bytes actually landed on disk (read back with
 * `node:fs/promises`); every refusal asserts nothing was written, inside or
 * outside the root. The symlink guards are POSIX-only, the suite's one skip.
 */
describe('the file write routes', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-files-write-');
    root = sandbox.root;
    apps = [];
    await mkdir(path.join(root, 'proj'));
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(): FastifyInstance {
    const app = createTestApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
    });
    apps.push(app);
    return app;
  }

  async function id(name: string): Promise<string> {
    return Buffer.from(await realpath(path.join(root, name)), 'utf8').toString('base64url');
  }

  async function filesUrl(query = ''): Promise<string> {
    return `/api/projects/${await id('proj')}/files${query}`;
  }

  describe('POST files (create)', () => {
    it('creates an empty file with 201 and the bytes land on disk', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('?path=new.txt'),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(201);
      expect(await readFile(path.join(root, 'proj', 'new.txt'), 'utf8')).toBe('');
    });

    it('creates a directory with 201', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('?path=sub'),
        payload: { kind: 'directory' },
      });

      expect(response.statusCode).toBe(201);
      expect((await lstat(path.join(root, 'proj', 'sub'))).isDirectory()).toBe(true);
    });

    it('creates inside a nested existing directory', async () => {
      await mkdir(path.join(root, 'proj', 'src'));

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('?path=src/nested.txt'),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(201);
      expect(await readFile(path.join(root, 'proj', 'src', 'nested.txt'), 'utf8')).toBe('');
    });

    it('refuses to create over an existing entry with 409', async () => {
      await writeFile(path.join(root, 'proj', 'exists.txt'), 'keep');
      await mkdir(path.join(root, 'proj', 'existsdir'));
      const app = makeApp();

      const file = await authed(app, {
        method: 'POST',
        url: await filesUrl('?path=exists.txt'),
        payload: { kind: 'file' },
      });
      const dir = await authed(app, {
        method: 'POST',
        url: await filesUrl('?path=existsdir'),
        payload: { kind: 'directory' },
      });

      expect(file.statusCode).toBe(409);
      expect(dir.statusCode).toBe(409);
      expect(await readFile(path.join(root, 'proj', 'exists.txt'), 'utf8')).toBe('keep');
    });

    it('rejects a missing or unknown kind with 400 and creates nothing', async () => {
      const app = makeApp();

      const noBody = await authed(app, { method: 'POST', url: await filesUrl('?path=x') });
      const noKind = await authed(app, { method: 'POST', url: await filesUrl('?path=x'), payload: {} });
      const badKind = await authed(app, {
        method: 'POST',
        url: await filesUrl('?path=x'),
        payload: { kind: 'symlink' },
      });

      expect(noBody.statusCode).toBe(400);
      expect(noKind.statusCode).toBe(400);
      expect(badKind.statusCode).toBe(400);
      await expect(lstat(path.join(root, 'proj', 'x'))).rejects.toThrow();
    });

    it('returns 404 for an unknown project', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: '/api/projects/not-a-project/files?path=x',
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when the parent directory is missing', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('?path=missing/x.txt'),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when the parent is a file', async () => {
      await writeFile(path.join(root, 'proj', 'f.txt'), 'x');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('?path=f.txt/x'),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for the root itself, which is never a valid target', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl(),
        payload: { kind: 'directory' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('refuses a traversal with the same 400 as a read and creates nothing outside the root', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl(`?path=${encodeURIComponent('../escape.txt')}`),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(400);
      await expect(lstat(path.join(root, 'escape.txt'))).rejects.toThrow();
    });

    it('rejects a NUL in ?path= with 400 and creates nothing', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl(`?path=${encodeURIComponent('\0')}`),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(400);
      expect(await readdir(path.join(root, 'proj'))).toEqual([]);
    });

    it.skipIf(win32)('refuses to create through an escaping symlink and never escapes', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'link'), linkType);

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('?path=link'),
        payload: { kind: 'file' },
      });

      expect(response.statusCode).toBe(400);
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
    });
  });

  describe('POST files/rename', () => {
    it('renames an entry with 200 and the bytes land at the new name', async () => {
      await writeFile(path.join(root, 'proj', 'old.txt'), 'data');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/rename?path=old.txt'),
        payload: { to: 'new.txt' },
      });

      expect(response.statusCode).toBe(200);
      expect(await readFile(path.join(root, 'proj', 'new.txt'), 'utf8')).toBe('data');
      await expect(lstat(path.join(root, 'proj', 'old.txt'))).rejects.toThrow();
    });

    it('returns 404 when renaming a missing entry', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/rename?path=nope.txt'),
        payload: { to: 'other.txt' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for a bad or missing to, and leaves the file untouched', async () => {
      await writeFile(path.join(root, 'proj', 'a.txt'), 'x');
      const app = makeApp();
      const url = await filesUrl('/rename?path=a.txt');

      const noBody = await authed(app, { method: 'POST', url });
      const missingTo = await authed(app, { method: 'POST', url, payload: {} });
      const notAString = await authed(app, { method: 'POST', url, payload: { to: 42 } });
      const withSlash = await authed(app, { method: 'POST', url, payload: { to: '../x' } });

      expect(noBody.statusCode).toBe(400);
      expect(missingTo.statusCode).toBe(400);
      expect(notAString.statusCode).toBe(400);
      expect(withSlash.statusCode).toBe(400);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('x');
    });

    it('returns 400 when renaming the project root', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/rename'),
        payload: { to: 'x' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  /**
   * The move route (ticket 44): `?path=` names the entry, the body's `to` names
   * the destination *directory*. The two ends come from different doors, so a
   * bad source is a write refusal and a bad destination is a read one.
   */
  describe('POST files/move', () => {
    it('moves a file into another directory with 200, and the bytes land there', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await writeFile(path.join(root, 'proj', 'a.txt'), 'data');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=a.txt'),
        payload: { to: 'src' },
      });

      expect(response.statusCode).toBe(200);
      expect(await readFile(path.join(root, 'proj', 'src', 'a.txt'), 'utf8')).toBe('data');
      await expect(lstat(path.join(root, 'proj', 'a.txt'))).rejects.toThrow();
    });

    it('moves a file back out to the root, which the empty destination names', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await writeFile(path.join(root, 'proj', 'src', 'a.txt'), 'data');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=src/a.txt'),
        payload: { to: '' },
      });

      expect(response.statusCode).toBe(200);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('data');
    });

    it('refuses a name collision with 409 and moves nothing', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await writeFile(path.join(root, 'proj', 'a.txt'), 'the source');
      await writeFile(path.join(root, 'proj', 'src', 'a.txt'), 'the one already there');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=a.txt'),
        payload: { to: 'src' },
      });

      expect(response.statusCode).toBe(409);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('the source');
      expect(await readFile(path.join(root, 'proj', 'src', 'a.txt'), 'utf8')).toBe('the one already there');
    });

    it('refuses the directory the file already lives in with 409', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await writeFile(path.join(root, 'proj', 'src', 'a.txt'), 'data');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=src/a.txt'),
        payload: { to: 'src' },
      });

      expect(response.statusCode).toBe(409);
      expect(await readFile(path.join(root, 'proj', 'src', 'a.txt'), 'utf8')).toBe('data');
    });

    it('refuses a folder into its own subtree with 400', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await mkdir(path.join(root, 'proj', 'src', 'nested'));

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=src'),
        payload: { to: 'src/nested' },
      });

      expect(response.statusCode).toBe(400);
      expect((await lstat(path.join(root, 'proj', 'src', 'nested'))).isDirectory()).toBe(true);
    });

    it('refuses a destination that is a file with 400', async () => {
      await writeFile(path.join(root, 'proj', 'a.txt'), 'data');
      await writeFile(path.join(root, 'proj', 'f.txt'), 'x');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=a.txt'),
        payload: { to: 'f.txt' },
      });

      expect(response.statusCode).toBe(400);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('data');
    });

    it('returns 404 for a missing source and for a missing destination', async () => {
      await writeFile(path.join(root, 'proj', 'a.txt'), 'data');
      const app = makeApp();

      const noSource = await authed(app, {
        method: 'POST',
        url: await filesUrl('/move?path=gone.txt'),
        payload: { to: '' },
      });
      const noDest = await authed(app, {
        method: 'POST',
        url: await filesUrl('/move?path=a.txt'),
        payload: { to: 'missing' },
      });

      expect(noSource.statusCode).toBe(404);
      expect(noDest.statusCode).toBe(404);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('data');
    });

    it('returns 400 when the project root is the source', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move'),
        payload: { to: '' },
      });

      expect(response.statusCode).toBe(400);
      expect((await lstat(path.join(root, 'proj'))).isDirectory()).toBe(true);
    });

    it('rejects a bad or missing to with 400 and moves nothing', async () => {
      await mkdir(path.join(root, 'proj', 'src'));
      await writeFile(path.join(root, 'proj', 'a.txt'), 'data');
      const app = makeApp();
      const url = await filesUrl('/move?path=a.txt');

      const noBody = await authed(app, { method: 'POST', url });
      const notAString = await authed(app, { method: 'POST', url, payload: { to: 42 } });
      const traversal = await authed(app, { method: 'POST', url, payload: { to: '../outside' } });
      const absolute = await authed(app, { method: 'POST', url, payload: { to: '/etc' } });

      expect(noBody.statusCode).toBe(400);
      expect(notAString.statusCode).toBe(400);
      expect(traversal.statusCode).toBe(400);
      expect(absolute.statusCode).toBe(400);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('data');
    });

    it('rejects a bad source path with the same 400 as every other route', async () => {
      await mkdir(path.join(root, 'proj', 'src'));

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl(`/move?path=${encodeURIComponent('../escape.txt')}`),
        payload: { to: 'src' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for an unknown project', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: '/api/projects/not-a-project/files/move?path=a.txt',
        payload: { to: '' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('never moves a file out of the root through an escaping symlink', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await writeFile(path.join(root, 'proj', 'a.txt'), 'data');
      await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'escape'), linkType);

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/move?path=a.txt'),
        payload: { to: 'escape' },
      });

      expect(response.statusCode).toBe(404);
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
      expect(await readFile(path.join(root, 'proj', 'a.txt'), 'utf8')).toBe('data');
    });
  });

  describe('DELETE files', () => {
    it('deletes a file with 200 and the bytes are gone', async () => {
      await writeFile(path.join(root, 'proj', 'gone.txt'), 'x');

      const response = await authed(makeApp(), {
        method: 'DELETE',
        url: await filesUrl('?path=gone.txt'),
      });

      expect(response.statusCode).toBe(200);
      await expect(lstat(path.join(root, 'proj', 'gone.txt'))).rejects.toThrow();
    });

    it('deletes a directory with its contents', async () => {
      await mkdir(path.join(root, 'proj', 'sub'));
      await writeFile(path.join(root, 'proj', 'sub', 'inner.txt'), 'x');

      const response = await authed(makeApp(), {
        method: 'DELETE',
        url: await filesUrl('?path=sub'),
      });

      expect(response.statusCode).toBe(200);
      await expect(lstat(path.join(root, 'proj', 'sub'))).rejects.toThrow();
    });

    it('returns 404 when deleting a missing entry', async () => {
      const response = await authed(makeApp(), {
        method: 'DELETE',
        url: await filesUrl('?path=nope.txt'),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when deleting the project root', async () => {
      const response = await authed(makeApp(), { method: 'DELETE', url: await filesUrl() });

      expect(response.statusCode).toBe(400);
      expect((await lstat(path.join(root, 'proj'))).isDirectory()).toBe(true);
    });
  });

  describe('PUT files/content (upload)', () => {
    it('uploads raw bytes with 201 and they land on disk', async () => {
      const bytes = Buffer.from([0x00, 0xff, 0x10, 0x41]);

      const response = await authed(makeApp(), {
        method: 'PUT',
        url: await filesUrl('/content?path=up.bin'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: bytes,
      });

      expect(response.statusCode).toBe(201);
      expect(await readFile(path.join(root, 'proj', 'up.bin'))).toEqual(bytes);
    });

    it('refuses to upload over an existing entry with 409', async () => {
      await writeFile(path.join(root, 'proj', 'up.bin'), 'first');

      const response = await authed(makeApp(), {
        method: 'PUT',
        url: await filesUrl('/content?path=up.bin'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('second'),
      });

      expect(response.statusCode).toBe(409);
      expect(await readFile(path.join(root, 'proj', 'up.bin'), 'utf8')).toBe('first');
    });

    it('rejects a missing or non-octet-stream body with 400', async () => {
      const app = makeApp();
      const url = await filesUrl('/content?path=up.bin');

      const noBody = await authed(app, { method: 'PUT', url });
      const jsonBody = await authed(app, { method: 'PUT', url, payload: { a: 1 } });

      expect(noBody.statusCode).toBe(400);
      expect(jsonBody.statusCode).toBe(400);
      await expect(lstat(path.join(root, 'proj', 'up.bin'))).rejects.toThrow();
    });

    it('rejects an upload larger than the cap with 413 and writes nothing', async () => {
      const response = await authed(makeApp(), {
        method: 'PUT',
        url: await filesUrl('/content?path=big.bin'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.allocUnsafe(MAX_UPLOAD_BYTES + 1),
      });

      expect(response.statusCode).toBe(413);
      await expect(lstat(path.join(root, 'proj', 'big.bin'))).rejects.toThrow();
    });
  });

  describe('POST files/save (overwrite)', () => {
    it('overwrites an existing file with 200 and the bytes land on disk', async () => {
      await writeFile(path.join(root, 'proj', 'note.txt'), 'first');
      const bytes = Buffer.from('second');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/save?path=note.txt'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: bytes,
      });

      expect(response.statusCode).toBe(200);
      expect(await readFile(path.join(root, 'proj', 'note.txt'))).toEqual(bytes);
    });

    it('returns 404 for a missing file and writes nothing', async () => {
      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/save?path=gone.txt'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('x'),
      });

      expect(response.statusCode).toBe(404);
      await expect(lstat(path.join(root, 'proj', 'gone.txt'))).rejects.toThrow();
    });

    it('returns 400 for a directory target', async () => {
      await mkdir(path.join(root, 'proj', 'sub'));

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/save?path=sub'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('x'),
      });

      expect(response.statusCode).toBe(400);
      expect((await lstat(path.join(root, 'proj', 'sub'))).isDirectory()).toBe(true);
    });

    it.skipIf(win32)('returns 400 for a symlink target and never escapes', async () => {
      await mkdir(path.join(sandbox.dir, 'outside'));
      await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'link'), linkType);

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/save?path=link'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('x'),
      });

      expect(response.statusCode).toBe(400);
      expect(await readdir(path.join(sandbox.dir, 'outside'))).toEqual([]);
    });

    it('rejects a missing or non-octet-stream body with 400', async () => {
      await writeFile(path.join(root, 'proj', 'note.txt'), 'keep');
      const app = makeApp();
      const url = await filesUrl('/save?path=note.txt');

      const noBody = await authed(app, { method: 'POST', url });
      const jsonBody = await authed(app, { method: 'POST', url, payload: { a: 1 } });

      expect(noBody.statusCode).toBe(400);
      expect(jsonBody.statusCode).toBe(400);
      expect(await readFile(path.join(root, 'proj', 'note.txt'), 'utf8')).toBe('keep');
    });

    it('rejects a save larger than the cap with 413 and leaves the file unchanged', async () => {
      await writeFile(path.join(root, 'proj', 'big.txt'), 'keep');

      const response = await authed(makeApp(), {
        method: 'POST',
        url: await filesUrl('/save?path=big.txt'),
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.allocUnsafe(MAX_UPLOAD_BYTES + 1),
      });

      expect(response.statusCode).toBe(413);
      expect(await readFile(path.join(root, 'proj', 'big.txt'), 'utf8')).toBe('keep');
    });
  });
});
