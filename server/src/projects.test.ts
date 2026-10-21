import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Project, SessionSummary } from '@clodeck/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppOptions } from './app.js';
import { createProjectDiscovery } from './discovery.js';
import {
  createTestApp,
  createSandbox,
  linkType,
  login,
  removeSandbox,
  type Sandbox,
} from './test-support.js';
import { createFakeProvider } from './testing/fake-provider.js';

/**
 * The projects REST surface at the HTTP boundary: the real handlers, the
 * installed gate, and a real temp projects root — `app.test.ts`'s shape, because
 * it is the same seam. The writes themselves are pinned on the discovery seam
 * (`discovery.test.ts`); what is pinned here is the routes: their codes, their
 * bodies, the state left on disk, and the session they need.
 */
describe('the projects API', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-projects-');
    root = sandbox.root;
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(
    projectsRoot: string | null,
    overrides: Partial<AppOptions> = {},
  ): FastifyInstance {
    const app = createTestApp({
      projects: createProjectDiscovery(projectsRoot, { warn: () => undefined }),
      ...overrides,
    });
    apps.push(app);
    return app;
  }

  /** The create, authenticated the way a browser is. An absent `payload` sends no body. */
  async function create(app: FastifyInstance, payload?: object): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: await login(app) },
      payload,
    });
  }

  /** The delete, authenticated the same way. */
  async function remove(app: FastifyInstance, id: string): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'DELETE',
      url: `/api/projects/${encodeURIComponent(id)}`,
      headers: { cookie: await login(app) },
    });
  }

  /** The id the wire carries: base64url of the canonical directory. */
  function idFor(candidate: string): string {
    return Buffer.from(candidate, 'utf8').toString('base64url');
  }

  it('creates the directory and answers 201 with the created project', async () => {
    const app = makeApp(root);

    const response = await create(app, { name: 'beta' });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { project: Project };
    expect(Object.keys(body)).toEqual(['project']);
    const canonical = await realpath(path.join(root, 'beta'));
    // `id` is the reversible base64url of the canonical path, exactly as the
    // list's rows are — a client that creates a project can address it at once.
    expect(body.project).toEqual({
      id: Buffer.from(canonical, 'utf8').toString('base64url'),
      name: 'beta',
      path: canonical,
    });

    // The same row `GET /projects` lists — one project, not two.
    const listed = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: await login(app) },
    });
    expect((listed.json() as { projects: Project[] }).projects).toEqual([body.project]);
  });

  it('answers 400 for a name that is not one clean, non-dot segment', async () => {
    const app = makeApp(root);

    for (const name of ['', '.', '..', '../escape', 'a/b', 'a\\b', '.hidden', 'x'.repeat(256)]) {
      const response = await create(app, { name });
      expect(response.statusCode, `name: ${JSON.stringify(name)}`).toBe(400);
      expect((response.json() as { error: string }).error).toMatch(/single|dot/);
    }
  });

  it('answers 400 when the body carries no name string', async () => {
    const app = makeApp(root);

    for (const payload of [undefined, {}, { name: 42 }, { name: null }]) {
      const response = await create(app, payload);
      expect(response.statusCode, `payload: ${JSON.stringify(payload)}`).toBe(400);
      expect((response.json() as { error: string }).error).toContain('name');
    }
  });

  it('answers 409 when something is already at the name, and overwrites nothing', async () => {
    await mkdir(path.join(root, 'taken'));
    await writeFile(path.join(root, 'notes.txt'), 'not a project');
    const app = makeApp(root);

    for (const name of ['taken', 'notes.txt']) {
      const response = await create(app, { name });
      expect(response.statusCode, `name: ${name}`).toBe(409);
      expect((response.json() as { error: string }).error).toBe('already exists');
    }

    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('not a project');
  });

  it('answers 503 when there is no projects root, never a silent success', async () => {
    await writeFile(path.join(sandbox.dir, 'a-file'), 'not a root');

    const unconfigured = await create(makeApp(null), { name: 'beta' });
    const absent = await create(makeApp(path.join(sandbox.dir, 'not-there')), { name: 'beta' });
    const notADirectory = await create(makeApp(path.join(sandbox.dir, 'a-file')), { name: 'beta' });

    expect(unconfigured.statusCode).toBe(503);
    expect(absent.statusCode).toBe(503);
    expect(notADirectory.statusCode).toBe(503);
    expect((unconfigured.json() as { error: string }).error).toContain('projects root');
  });

  it('answers 401 to a create with no session', async () => {
    const app = makeApp(root);

    const response = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'beta' } });

    expect(response.statusCode).toBe(401);
  });

  describe('deleting a project', () => {
    it('removes the directory recursively and answers 204 with no body', async () => {
      await mkdir(path.join(root, 'alpha', 'nested'), { recursive: true });
      await writeFile(path.join(root, 'alpha', 'nested', 'notes.txt'), 'gone');
      const canonical = await realpath(path.join(root, 'alpha'));
      const app = makeApp(root);

      const response = await remove(app, idFor(canonical));

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      await expect(lstat(path.join(root, 'alpha'))).rejects.toMatchObject({ code: 'ENOENT' });
      // The list is the disk: the row is gone with the directory.
      const listed = await app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { cookie: await login(app) },
      });
      expect((listed.json() as { projects: Project[] }).projects).toEqual([]);
    });

    it('answers 404 for an id that does not resolve, the root included, and deletes nothing', async () => {
      const outside = path.join(sandbox.dir, 'outside');
      await mkdir(outside);
      await mkdir(path.join(root, 'alpha'));
      const app = makeApp(root);

      for (const id of [
        idFor(path.join(root, 'ghost')),
        idFor(await realpath(outside)),
        idFor(await realpath(root)),
        'not!base64url',
      ]) {
        const response = await remove(app, id);
        expect(response.statusCode, `id: ${id}`).toBe(404);
        expect((response.json() as { error: string }).error).toBe('not found');
      }

      // The allowlist boundary holds on both sides, and the root is not a project.
      await expect(lstat(path.join(root, 'alpha'))).resolves.toBeDefined();
      await expect(lstat(outside)).resolves.toBeDefined();
      await expect(lstat(root)).resolves.toBeDefined();
    });

    it('answers 400 symlink for an ambiguous id, removing neither the link nor the target', async () => {
      // The scan lists `alpha` as the row for `zulu`'s id, and both entries name
      // the same canonical path: the delete cannot know which label was meant
      // (decision 87, D6).
      await mkdir(path.join(root, 'zulu'));
      await writeFile(path.join(root, 'zulu', 'notes.txt'), 'keep me');
      await symlink(path.join(root, 'zulu'), path.join(root, 'alpha'), linkType);
      const canonical = await realpath(path.join(root, 'zulu'));
      const app = makeApp(root);

      const response = await remove(app, idFor(canonical));

      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: string }).error).toBe('symlink');
      await expect(readFile(path.join(root, 'zulu', 'notes.txt'), 'utf8')).resolves.toBe('keep me');
      expect((await lstat(path.join(root, 'alpha'))).isSymbolicLink()).toBe(true);
    });

    it('leaves the SDK transcripts alone: the provider is never asked to delete one', async () => {
      // The transcripts live outside the project directory, and D2 leaves them
      // there on purpose — deleting the directory must not reach through the
      // provider seam.
      const sessions: SessionSummary[] = [{ id: 's1', title: 'Older work' }];
      const provider = createFakeProvider({ sessions });
      const app = makeApp(root, { provider });
      await mkdir(path.join(root, 'alpha'));
      const canonical = await realpath(path.join(root, 'alpha'));

      const response = await remove(app, idFor(canonical));

      expect(response.statusCode).toBe(204);
      expect(provider.deletedSessions).toEqual([]);
      await expect(provider.listSessions(canonical)).resolves.toEqual(sessions);
    });

    it('answers 401 to a delete with no session', async () => {
      await mkdir(path.join(root, 'alpha'));
      const canonical = await realpath(path.join(root, 'alpha'));
      const app = makeApp(root);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${encodeURIComponent(idFor(canonical))}`,
      });

      expect(response.statusCode).toBe(401);
      await expect(lstat(canonical)).resolves.toBeDefined();
    });
  });
});
