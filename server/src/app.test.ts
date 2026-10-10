import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createProjectDiscovery } from './discovery.js';
import { createSandbox, linkType, removeSandbox, type Sandbox } from './test-support.js';
import { createFakePtySpawner } from './testing/fake-pty.js';
import { createFakeProvider } from './testing/fake-provider.js';

/**
 * The HTTP boundary is where the endpoint's external behavior is pinned: real
 * route handler, real filesystem, real temp projects root — no `fs` mocking,
 * no private functions. `app.inject()` boots the handler without a socket.
 */
describe('the server API', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-app-');
    root = sandbox.root;
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(projectsRoot: string | null): FastifyInstance {
    const app = buildApp({
      projects: createProjectDiscovery(projectsRoot, { warn: () => undefined }),
      // The scripted fakes, so no suite here ever needs an API key, the network,
      // or a real shell.
      provider: createFakeProvider(),
      spawner: createFakePtySpawner(),
    });
    apps.push(app);
    return app;
  }

  it('answers GET /healthz with 200 and no auth', async () => {
    const response = await makeApp(root).inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
  });

  it('returns the child directories at GET /api/projects, ordered by name', async () => {
    for (const name of ['mike', 'Zulu', 'alpha']) {
      await mkdir(path.join(root, name));
    }

    const response = await makeApp(root).inject({ method: 'GET', url: '/api/projects' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { projects: Project[] };
    expect(Object.keys(body)).toEqual(['projects']);
    expect(body.projects.map((project) => project.name)).toEqual(['alpha', 'mike', 'Zulu']);

    for (const project of body.projects) {
      // `path` is the canonical absolute directory …
      expect(project.path).toBe(await realpath(path.join(root, project.name)));
      // … and `id` is a URL-safe token that decodes back to it.
      expect(project.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(project.id, 'base64url').toString('utf8')).toBe(project.path);
    }
  });

  it('lists immediate child directories only, skipping dotdirs, files and escaping symlinks', async () => {
    await mkdir(path.join(root, 'empty')); // empty is fine — no marker file required
    await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true }); // `deeper` is not a project
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, 'notes.txt'), 'not a project');
    await mkdir(path.join(sandbox.dir, 'outside'));
    await symlink(path.join(sandbox.dir, 'outside'), path.join(root, 'escape'), linkType);
    await symlink(path.join(root, 'nested', 'deeper'), path.join(root, 'linked'), linkType);

    const response = await makeApp(root).inject({ method: 'GET', url: '/api/projects' });

    const body = response.json() as { projects: Project[] };
    expect(body.projects.map((project) => project.name)).toEqual(['empty', 'linked', 'nested']);
    // An in-root symlink is listed under its own name, but points at its real target.
    expect(body.projects.find((project) => project.name === 'linked')?.path).toBe(
      await realpath(path.join(root, 'nested', 'deeper')),
    );
  });

  it('lists a directory once when a sibling symlink resolves to it', async () => {
    await mkdir(path.join(root, 'alpha'));
    await symlink(path.join(root, 'alpha'), path.join(root, 'alpha-alias'), linkType);

    const response = await makeApp(root).inject({ method: 'GET', url: '/api/projects' });

    const projects = (response.json() as { projects: Project[] }).projects;
    // The id *is* the canonical path, so one directory must not arrive twice.
    expect(projects.map((project) => project.name)).toEqual(['alpha']);
    expect(new Set(projects.map((project) => project.id)).size).toBe(projects.length);
  });

  it('answers 200 with an empty list when the root is missing or unconfigured', async () => {
    const missing = await makeApp(path.join(sandbox.dir, 'not-there')).inject({
      method: 'GET',
      url: '/api/projects',
    });
    const unconfigured = await makeApp(null).inject({ method: 'GET', url: '/api/projects' });

    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({ projects: [] });
    expect(unconfigured.statusCode).toBe(200);
    expect(unconfigured.json()).toEqual({ projects: [] });
  });

  it('re-scans on every request, so a dropped folder appears on the next call', async () => {
    const app = makeApp(root);

    const before = await app.inject({ method: 'GET', url: '/api/projects' });
    expect((before.json() as { projects: Project[] }).projects).toEqual([]);

    await mkdir(path.join(root, 'dropped-in'));

    const after = await app.inject({ method: 'GET', url: '/api/projects' });
    expect((after.json() as { projects: Project[] }).projects.map((project) => project.name)).toEqual([
      'dropped-in',
    ]);
  });

  it('takes the projects root from the PROJECTS_ROOT environment variable', async () => {
    const configured = path.join(sandbox.dir, 'configured-root');
    await mkdir(path.join(configured, 'from-env'), { recursive: true });

    const config = loadConfig({
      env: { PROJECTS_ROOT: configured },
      configPath: path.join(sandbox.dir, 'absent.config.json'),
    });

    const response = await makeApp(config.projectsRoot).inject({ method: 'GET', url: '/api/projects' });
    expect((response.json() as { projects: Project[] }).projects.map((project) => project.name)).toEqual([
      'from-env',
    ]);
  });

  it('falls back to projectsRoot in the config file when the env var is absent', async () => {
    const configured = path.join(sandbox.dir, 'configured-root');
    await mkdir(path.join(configured, 'from-file'), { recursive: true });
    const configPath = path.join(sandbox.dir, 'clodeck.config.json');
    await writeFile(configPath, JSON.stringify({ projectsRoot: configured }));

    const config = loadConfig({ env: {}, configPath });

    expect(config.projectsRoot).toBe(configured);
    const response = await makeApp(config.projectsRoot).inject({ method: 'GET', url: '/api/projects' });
    expect((response.json() as { projects: Project[] }).projects.map((project) => project.name)).toEqual([
      'from-file',
    ]);
  });

  it('reports an unusable config file instead of failing, and serves an empty list', async () => {
    const brokenPath = path.join(sandbox.dir, 'broken.config.json');
    await writeFile(brokenPath, '{ "projectsRoot": ');
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);

    const broken = loadConfig({ env: {}, configPath: brokenPath, warn });
    const absent = loadConfig({ env: {}, configPath: path.join(sandbox.dir, 'absent.config.json'), warn });

    expect(broken.projectsRoot).toBeNull();
    expect(warnings.join('\n')).toContain('broken.config.json');
    // An absent config file is the normal case, so it is not reported.
    expect(absent.projectsRoot).toBeNull();
    expect(warnings).toHaveLength(1);

    const response = await makeApp(broken.projectsRoot).inject({ method: 'GET', url: '/api/projects' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projects: [] });
  });

  // File symlinks need elevation or Developer Mode on Windows, so this case is
  // only creatable on POSIX.
  it.skipIf(process.platform === 'win32')('skips a symlink that points at a file', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'not a project');
    await symlink(path.join(root, 'notes.txt'), path.join(root, 'notes-link'), 'file');

    const response = await makeApp(root).inject({ method: 'GET', url: '/api/projects' });

    expect((response.json() as { projects: Project[] }).projects).toEqual([]);
  });
});
