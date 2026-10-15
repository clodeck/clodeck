import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  createSandbox,
  createTestApp,
  handshake,
  listen,
  login,
  removeSandbox,
  type Sandbox,
} from './test-support.js';

/**
 * Serving the built client (spec-06 §"Ticket 27", spec-07 §"The web root"). The
 * seam is the same one the rest of the server is tested at: the real app,
 * through `inject()`, against a real directory on disk — a web root is a path,
 * not a facade, so there is nothing here to fake. What is asserted is what the
 * browser sees: the bundle, the deep-link fallback, and — the part that matters
 * — that the bundle being public does not move the gate.
 */

const INDEX_HTML = '<!doctype html><title>clodeck</title><script src="/assets/app.js"></script>';
const APP_JS = 'console.log("clodeck");';

describe('serving the built client', () => {
  let sandbox: Sandbox;
  /** A stand-in for this repository: a workspace root, and a built client under it. */
  let repo: string;
  let webRoot: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-static-');
    repo = path.join(sandbox.dir, 'repo');
    // A stand-in for `web/dist`: one html entry point and one hashed asset.
    webRoot = path.join(repo, 'web', 'dist');
    await mkdir(path.join(webRoot, 'assets'), { recursive: true });
    await writeFile(path.join(webRoot, 'index.html'), INDEX_HTML);
    await writeFile(path.join(webRoot, 'assets', 'app.js'), APP_JS);
    // The two levels the server is started from: the manifest that names the
    // workspaces, and the `server/` package inside it that names none — the
    // tree the resolver walks when `WEB_ROOT` is unset.
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['web'] }),
    );
    await mkdir(path.join(repo, 'server'));
    await writeFile(path.join(repo, 'server', 'package.json'), JSON.stringify({ name: '@clodeck/server' }));
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(root: string | null = webRoot): FastifyInstance {
    // The only suite that sets `webRoot` to anything — this is the one about
    // serving the bundle (spec-06 §27).
    const app = createTestApp({ webRoot: root });
    apps.push(app);
    return app;
  }

  /** What a browser navigating to `url` sends, and what it accepts back. */
  function navigate(app: FastifyInstance, url: string) {
    return app.inject({ method: 'GET', url, headers: { accept: 'text/html' } });
  }

  it('serves the index at / with an html content type', async () => {
    const response = await navigate(makeApp(), '/');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toBe(INDEX_HTML);
  });

  it('serves an asset from the bundle as itself, not as the index', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/assets/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.body).toBe(APP_JS);
  });

  it('falls back to the index for a client-side route no file backs', async () => {
    const response = await navigate(makeApp(), '/projects/alpha/sessions');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toBe(INDEX_HTML);
  });

  it('answers 404 for a path that is missing and does not want html', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/nope.txt' });

    expect(response.statusCode).toBe(404);
  });

  it('leaves /healthz and the gated /api to the routes that own them', async () => {
    const app = makeApp();

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    const anonymous = await app.inject({ method: 'GET', url: '/api/projects' });
    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { cookie: await login(app) },
    });

    expect(health.statusCode).toBe(200);
    // A public bundle must not be a public API: the wildcard serves files, it
    // does not stand in front of the gate.
    expect(anonymous.statusCode).toBe(401);
    expect(authenticated.statusCode).toBe(200);
    expect((authenticated.json() as { projects: Project[] }).projects).toEqual([]);
  });

  it('answers 404 for a path the server owns that matches no route, not the app shell', async () => {
    const app = makeApp();

    // The fallback is for the *client's* routes. `/api/**` and `/ws/**` are the
    // server's, so an html-accepting request there is still a missing resource —
    // and the 404 is what an unauthenticated caller saw before this slice too.
    const api = await navigate(app, '/api/typo');
    const socket = await navigate(app, '/ws/typo');

    expect(api.statusCode).toBe(404);
    expect(api.body).not.toContain('<title>');
    expect(socket.statusCode).toBe(404);
  });

  it('leaves /ws/terminal to its own route, not the static catch-all', async () => {
    // A real route under a server-owned path, asked for as a browser asks for a
    // page: the socket's gate answers, and the bundle answers nothing (spec-07
    // §"The web root": no route is shadowed).
    const response = await navigate(makeApp(), '/ws/terminal?projectId=whatever');

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('<title>');
  });

  it('leaves a /ws upgrade without a session refused, not answered with the index', async () => {
    const app = makeApp();
    const port = await listen(app);
    const projectId = 'not-used-by-the-refusal';

    const result = await handshake(
      `ws://127.0.0.1:${String(port)}/ws?projectId=${encodeURIComponent(projectId)}`,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('serves nothing at all when webRoot is null', async () => {
    const app = makeApp(null);

    const root = await navigate(app, '/');
    const deep = await navigate(app, '/projects/alpha');

    expect(root.statusCode).toBe(404);
    expect(deep.statusCode).toBe(404);
  });

  /**
   * The web root an operator never declared (spec-07 §"The web root"): with
   * `WEB_ROOT` unset the server resolves one for itself, and serves it exactly
   * as it serves an explicit one — so `GET /` is the app rather than the 404
   * that sent the operator to the logs. Nothing to find is the dev loop's case,
   * and it looks the way it did before any of this existed.
   */
  describe('when WEB_ROOT is unset', () => {
    /** What a server started in `cwd` loads, with nothing declared but its directory. */
    function configFrom(cwd: string) {
      return loadConfig({
        env: {},
        cwd,
        configPath: path.join(sandbox.dir, 'absent.config.json'),
        warn: () => undefined,
      });
    }

    it('serves the build the resolver walks up to', async () => {
      const app = makeApp(configFrom(path.join(repo, 'server')).webRoot);

      const shell = await navigate(app, '/');
      const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
      const deep = await navigate(app, '/projects/alpha/sessions');

      expect(shell.statusCode).toBe(200);
      expect(shell.body).toBe(INDEX_HTML);
      expect(asset.body).toBe(APP_JS);
      expect(deep.body).toBe(INDEX_HTML);
    });

    it('serves nothing when there is no build above the working directory', async () => {
      const bare = path.join(sandbox.dir, 'bare');
      await mkdir(bare);

      const config = configFrom(bare);

      expect(config.webRoot).toBeNull();
      expect((await navigate(makeApp(config.webRoot), '/')).statusCode).toBe(404);
    });

    it('serves the WEB_ROOT it was given rather than the build above the working directory', async () => {
      const elsewhere = path.join(sandbox.dir, 'elsewhere');
      const operatorIndex = '<!doctype html><title>the operator said so</title>';
      await mkdir(elsewhere);
      await writeFile(path.join(elsewhere, 'index.html'), operatorIndex);

      const config = loadConfig({
        env: { WEB_ROOT: elsewhere },
        cwd: path.join(repo, 'server'),
        configPath: path.join(sandbox.dir, 'absent.config.json'),
        warn: () => undefined,
      });

      expect(config.webRoot).toBe(elsewhere);
      expect((await navigate(makeApp(config.webRoot), '/')).body).toBe(operatorIndex);
    });
  });
});
