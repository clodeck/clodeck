import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectDiscovery } from './discovery.js';
import { createTestApp, createSandbox, login, removeSandbox, type Sandbox } from './test-support.js';

/**
 * `POST /api/projects` (ticket 47) at the HTTP boundary: the real handler, the
 * installed gate, and a real temp projects root — `app.test.ts`'s shape, because
 * it is the same seam. The write itself is pinned on the discovery seam
 * (`discovery.test.ts`); what is pinned here is the route: its codes, its body,
 * and the session it needs.
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

  function makeApp(projectsRoot: string | null): FastifyInstance {
    const app = createTestApp({
      projects: createProjectDiscovery(projectsRoot, { warn: () => undefined }),
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
});
