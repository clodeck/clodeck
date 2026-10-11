import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { buildApp } from './app.js';
import { createProjectDiscovery } from './discovery.js';
import { createSandbox, createTestAuth, login, removeSandbox, type Sandbox } from './test-support.js';
import { createFakePtySpawner } from './testing/fake-pty.js';
import { createFakeProvider } from './testing/fake-provider.js';

/**
 * Serving the built client (spec-06 §"Ticket 27"). The seam is the same one the
 * rest of the server is tested at: the real app, through `inject()`, against a
 * real directory on disk — `WEB_ROOT` is a path, not a facade, so there is
 * nothing here to fake (spec-06 §"Ticket 27"). What is asserted is what the
 * browser sees: the bundle, the deep-link fallback, and — the part that matters
 * — that the bundle being public does not move the gate.
 */

const INDEX_HTML = '<!doctype html><title>clodeck</title><script src="/assets/app.js"></script>';
const APP_JS = 'console.log("clodeck");';

describe('serving the built client', () => {
  let sandbox: Sandbox;
  let webRoot: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-static-');
    // A stand-in for `web/dist`: one html entry point and one hashed asset.
    webRoot = path.join(sandbox.dir, 'web-dist');
    await mkdir(path.join(webRoot, 'assets'), { recursive: true });
    await writeFile(path.join(webRoot, 'index.html'), INDEX_HTML);
    await writeFile(path.join(webRoot, 'assets', 'app.js'), APP_JS);
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(root: string | null = webRoot): FastifyInstance {
    const app = buildApp({
      projects: createProjectDiscovery(sandbox.root, { warn: () => undefined }),
      provider: createFakeProvider(),
      spawner: createFakePtySpawner(),
      auth: createTestAuth(),
      webRoot: root,
    });
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

  async function listen(app: FastifyInstance): Promise<number> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the test server did not bind a port');
    }
    return address.port;
  }

  /** What the client sees: `open`, or the error that refused the upgrade. */
  function handshake(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<{ ok: boolean; error: string }> {
    return new Promise((resolve) => {
      const socket = new WebSocket(url, { headers });
      socket.on('open', () => {
        socket.close();
        resolve({ ok: true, error: '' });
      });
      socket.on('error', (error: Error) => {
        resolve({ ok: false, error: error.message });
      });
    });
  }
});
