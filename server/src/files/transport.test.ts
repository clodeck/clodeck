import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FileContent, FileEntry } from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { createProjectDiscovery } from '../discovery.js';
import { createSandbox, linkType, removeSandbox, type Sandbox } from '../test-support.js';
import { createFakePtySpawner } from '../testing/fake-pty.js';
import { createFakeProvider } from '../testing/fake-provider.js';

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
    const app = buildApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      provider: createFakeProvider(),
      spawner: createFakePtySpawner(),
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

    const response = await makeApp().inject({ method: 'GET', url: `/api/projects/${await id('proj')}/files` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { entries: FileEntry[] };
    expect(Object.keys(body)).toEqual(['entries']);
    expect(body.entries.map((entry) => entry.name)).toEqual(['alpha', 'zeta', 'a.txt']);
  });

  it('lists a nested directory through ?path=', async () => {
    await mkdir(path.join(root, 'proj', 'sub'));
    await writeFile(path.join(root, 'proj', 'sub', 'inner.txt'), 'x');

    const response = await makeApp().inject({
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

    const small = await app.inject({
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files/content?path=small.txt`,
    });
    expect(small.statusCode).toBe(200);
    expect(small.json()).toEqual({
      content: { kind: 'text', content: 'hello', truncated: false, size: 5 },
    });

    const big = await app.inject({
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files/content?path=big.txt`,
    });
    expect((big.json() as { content: FileContent }).content).toMatchObject({ kind: 'text', truncated: true });
  });

  it('serves binary as 200 with kind binary, not an error', async () => {
    await writeFile(path.join(root, 'proj', 'blob'), Buffer.from([0x00, 0x01]));

    const response = await makeApp().inject({
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files/content?path=blob`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ content: { kind: 'binary', size: 2 } });
  });

  it('rejects a traversal and an absolute path with 400', async () => {
    const app = makeApp();
    const pid = await id('proj');

    const traversal = await app.inject({ method: 'GET', url: `/api/projects/${pid}/files?path=..` });
    expect(traversal.statusCode).toBe(400);

    const absolute = await app.inject({ method: 'GET', url: `/api/projects/${pid}/files?path=${encodeURIComponent('/etc')}` });
    expect(absolute.statusCode).toBe(400);
  });

  it('returns 404 for an unknown project', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/api/projects/not-a-project/files' });

    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when the path is the wrong kind for the endpoint', async () => {
    await mkdir(path.join(root, 'proj', 'dir'));
    await writeFile(path.join(root, 'proj', 'file.txt'), 'x');
    const app = makeApp();
    const pid = await id('proj');

    const listOnFile = await app.inject({ method: 'GET', url: `/api/projects/${pid}/files?path=file.txt` });
    expect(listOnFile.statusCode).toBe(400);

    const contentOnDir = await app.inject({ method: 'GET', url: `/api/projects/${pid}/files/content?path=dir` });
    expect(contentOnDir.statusCode).toBe(400);
  });

  it('returns 404 when the path resolves outside the root through a symlink', async () => {
    await mkdir(path.join(sandbox.dir, 'outside'));
    await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'proj', 'escape'), linkType);

    const response = await makeApp().inject({
      method: 'GET',
      url: `/api/projects/${await id('proj')}/files?path=escape`,
    });

    expect(response.statusCode).toBe(404);
  });
});
