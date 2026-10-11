import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import { createProjectDiscovery } from './discovery.js';
import {
  createSandbox,
  createTestApp,
  handshake,
  linkType,
  listen,
  login,
  removeSandbox,
  TEST_PASSWORD,
  type Sandbox,
} from './test-support.js';

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
    // The shared factory: the scripted fakes and the real gate, so nothing here
    // needs an API key, the network, or a real shell.
    const app = createTestApp({
      projects: createProjectDiscovery(projectsRoot, { warn: () => undefined }),
    });
    apps.push(app);
    return app;
  }

  /** One gated GET, authenticated the way a browser would be. */
  async function getProjects(app: FastifyInstance) {
    return app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: await login(app) } });
  }

  it('answers GET /healthz with 200 and no auth', async () => {
    const response = await makeApp(root).inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
  });

  it('returns the child directories at GET /api/projects, ordered by name', async () => {
    for (const name of ['mike', 'Zulu', 'alpha']) {
      await mkdir(path.join(root, name));
    }

    const response = await getProjects(makeApp(root));

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

    const response = await getProjects(makeApp(root));

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

    const response = await getProjects(makeApp(root));

    const projects = (response.json() as { projects: Project[] }).projects;
    // The id *is* the canonical path, so one directory must not arrive twice.
    expect(projects.map((project) => project.name)).toEqual(['alpha']);
    expect(new Set(projects.map((project) => project.id)).size).toBe(projects.length);
  });

  it('answers 200 with an empty list when the root is missing or unconfigured', async () => {
    const missing = await getProjects(makeApp(path.join(sandbox.dir, 'not-there')));
    const unconfigured = await getProjects(makeApp(null));

    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({ projects: [] });
    expect(unconfigured.statusCode).toBe(200);
    expect(unconfigured.json()).toEqual({ projects: [] });
  });

  it('re-scans on every request, so a dropped folder appears on the next call', async () => {
    const app = makeApp(root);
    const cookie = await login(app);

    const before = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    expect((before.json() as { projects: Project[] }).projects).toEqual([]);

    await mkdir(path.join(root, 'dropped-in'));

    const after = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
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

    const response = await getProjects(makeApp(config.projectsRoot));
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
    const response = await getProjects(makeApp(config.projectsRoot));
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

    const response = await getProjects(makeApp(broken.projectsRoot));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ projects: [] });
  });

  it('takes the password from UI_PASSWORD, then from UI_PASSWORD_FILE', async () => {
    const secretFile = path.join(sandbox.dir, 'password.txt');
    await writeFile(secretFile, 'from-the-file\n');
    const configPath = path.join(sandbox.dir, 'absent.config.json');
    const warn = () => undefined;

    const fromEnv = loadConfig({ env: { UI_PASSWORD: 'from-the-env' }, configPath, warn });
    const fromFile = loadConfig({ env: { UI_PASSWORD_FILE: secretFile }, configPath, warn });
    const both = loadConfig({
      env: { UI_PASSWORD: 'from-the-env', UI_PASSWORD_FILE: secretFile },
      configPath,
      warn,
    });

    expect(fromEnv.uiPassword).toBe('from-the-env');
    // A secret file is trimmed: a trailing newline is the classic way a
    // configured password stops matching what the operator typed.
    expect(fromFile.uiPassword).toBe('from-the-file');
    expect(both.uiPassword).toBe('from-the-env');
  });

  it('answers null for a password that is unset, blank, or unreadable', async () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    const configPath = path.join(sandbox.dir, 'absent.config.json');
    const unreadable = path.join(sandbox.dir, 'no-such-password.txt');
    const blankFile = path.join(sandbox.dir, 'blank.txt');
    await writeFile(blankFile, '\n');

    const unset = loadConfig({ env: {}, configPath, warn });
    const blank = loadConfig({ env: { UI_PASSWORD: '   ' }, configPath, warn });
    const missing = loadConfig({ env: { UI_PASSWORD_FILE: unreadable }, configPath, warn });
    const empty = loadConfig({ env: { UI_PASSWORD_FILE: blankFile }, configPath, warn });

    expect(unset.uiPassword).toBeNull();
    expect(blank.uiPassword).toBeNull();
    // Unset is a valid state (the server boots fail-closed) so it is not
    // reported; a file that exists but cannot be read is.
    expect(missing.uiPassword).toBeNull();
    expect(warnings.join('\n')).toContain('no-such-password.txt');
    expect(empty.uiPassword).toBeNull();
  });

  it('takes the web root from WEB_ROOT, and answers null when it is unset or blank', async () => {
    const built = path.join(sandbox.dir, 'web-dist');
    const configPath = path.join(sandbox.dir, 'absent.config.json');

    const set = loadConfig({ env: { WEB_ROOT: `  ${built}  ` }, configPath });
    const unset = loadConfig({ env: {}, configPath });
    const blank = loadConfig({ env: { WEB_ROOT: '   ' }, configPath });

    // A path, resolved the way the projects root is: the static plugin needs an
    // absolute one, and a leading space typed into a compose file is not one.
    expect(set.webRoot).toBe(path.resolve(built));
    // Unset is the dev loop: Vite serves the client, this server serves none.
    expect(unset.webRoot).toBeNull();
    expect(blank.webRoot).toBeNull();
  });

  // File symlinks need elevation or Developer Mode on Windows, so this case is
  // only creatable on POSIX.
  it.skipIf(process.platform === 'win32')('skips a symlink that points at a file', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'not a project');
    await symlink(path.join(root, 'notes.txt'), path.join(root, 'notes-link'), 'file');

    const response = await getProjects(makeApp(root));

    expect((response.json() as { projects: Project[] }).projects).toEqual([]);
  });

  describe('the installed auth gate', () => {
    it('answers 401 to every gated route until the login route hands out a cookie', async () => {
      await mkdir(path.join(root, 'alpha'));
      const app = makeApp(root);

      const anonymous = await app.inject({ method: 'GET', url: '/api/projects' });
      const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
      // The login routes are the exemption, and they stay reachable — a gate
      // that also covered them would be a server nobody could ever enter.
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: TEST_PASSWORD },
      });

      expect(anonymous.statusCode).toBe(401);
      expect(me.statusCode).toBe(401);
      expect(login.statusCode).toBe(200);
    });

    it('serves the same route once the cookie from a real login rides the request', async () => {
      await mkdir(path.join(root, 'alpha'));
      const app = makeApp(root);

      const anonymous = await app.inject({ method: 'GET', url: '/api/projects' });
      const cookie = await login(app);
      const authenticated = await app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { cookie },
      });

      expect(anonymous.statusCode).toBe(401);
      expect(authenticated.statusCode).toBe(200);
      expect((authenticated.json() as { projects: Project[] }).projects.map((p) => p.name)).toEqual([
        'alpha',
      ]);
    });

    it('answers 401 to a /ws upgrade that carries no session, and accepts one that does', async () => {
      await mkdir(path.join(root, 'alpha'));
      const app = makeApp(root);
      const port = await listen(app);
      const projectId = Buffer.from(await realpath(path.join(root, 'alpha')), 'utf8').toString('base64url');
      const url = `ws://127.0.0.1:${String(port)}/ws?projectId=${encodeURIComponent(projectId)}`;

      const anonymous = await handshake(url);
      expect(anonymous.ok).toBe(false);
      expect(anonymous.error).toContain('401');

      const cookie = await login(app);
      const authenticated = await handshake(url, { cookie });
      // The gate is in front of the *route*, not the bus: an authenticated
      // upgrade still reaches the bus and gets its opening snapshot.
      expect(authenticated.ok).toBe(true);
      await expect(authenticated.first).resolves.toContain('"kind":"snapshot"');
    });

    it('answers 401 to a /ws/terminal upgrade that carries no session', async () => {
      await mkdir(path.join(root, 'alpha'));
      const app = makeApp(root);
      const port = await listen(app);
      const projectId = Buffer.from(await realpath(path.join(root, 'alpha')), 'utf8').toString('base64url');

      const result = await handshake(
        `ws://127.0.0.1:${String(port)}/ws/terminal?projectId=${encodeURIComponent(projectId)}`,
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('401');
    });
  });
});
