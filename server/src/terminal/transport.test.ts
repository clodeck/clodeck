import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { buildApp } from '../app.js';
import { createProjectDiscovery } from '../discovery.js';
import { createSandbox, createTestAuth, login, removeSandbox, type Sandbox } from '../test-support.js';
import { createFakePtySpawner, type FakePtySpawner } from '../testing/fake-pty.js';
import { createFakeProvider } from '../testing/fake-provider.js';

/**
 * The `/ws/terminal` transport and its resize endpoint, driven end to end: a
 * real socket on an ephemeral loopback port and the real route, against the
 * scripted fake spawner — no shell, no API key, no network (spec-03 §Testing).
 *
 * Every assertion reads the wire (raw bytes, and the REST status) or the fake's
 * control surface, never the route's internals, so the tests pin *behavior*: a
 * connection spawns a shell in the project directory, bytes flow both ways, and
 * the connection owns its shell through its whole life.
 */
describe('the /ws/terminal transport', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-terminal-');
    root = sandbox.root;
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  /**
   * An app, its fake spawner, and the `cookie` header its requests and socket
   * handshakes need — logged in through the real route, because the gate fronts
   * `/ws/terminal` and the size endpoint and has no bypass (spec-05 §Testing).
   */
  async function makeApp(): Promise<{ app: FastifyInstance; spawner: FakePtySpawner; cookie: string }> {
    const spawner = createFakePtySpawner();
    const app = buildApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      provider: createFakeProvider(),
      spawner,
      auth: createTestAuth(),
    });
    apps.push(app);
    return { app, spawner, cookie: await login(app) };
  }

  /** A project directory inside the allowlist, with the id the wire carries. */
  async function project(name: string): Promise<{ id: string; cwd: string }> {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    const cwd = await realpath(dir);
    return { id: Buffer.from(cwd, 'utf8').toString('base64url'), cwd };
  }

  async function listen(app: FastifyInstance): Promise<number> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the test server did not bind a port');
    }
    return address.port;
  }

  it('spawns a shell in the resolved project directory when the socket connects', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);

    // The cwd is the canonical path, never the raw id: the route re-enters
    // through `resolveProject` before anything is spawned.
    await expect(spawner.waitForSpawn(1)).resolves.toEqual({
      cwd: alpha.cwd,
      cols: 80,
      rows: 24,
    });
    client.close();
  });

  it('streams the shell’s output to the socket', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    spawner.handle(1).emitData('hello from the shell');

    await expect(client.next()).resolves.toBe('hello from the shell');
    client.close();
  });

  it('writes the client’s bytes into the shell', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    client.send('ls\r');
    await until(() => spawner.handle(1).written.length === 1);

    expect(spawner.handle(1).written).toEqual(['ls\r']);
    client.close();
  });

  it('kills the shell and forgets it when the socket closes', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    client.close();
    await client.waitForClose();
    await until(() => spawner.handle(1).killCount === 1);

    expect(spawner.handle(1).killCount).toBe(1);
    // The project is forgotten, not left with a dead shell: a resize now 404s.
    const response = await app.inject(sizeRequest(alpha.id, { cols: 90, rows: 30 }, cookie));
    expect(response.statusCode).toBe(404);
  });

  it('closes the socket and cleans up when the shell exits on its own', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    spawner.handle(1).exit(0);

    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1000 });
    // An exit is not a kill, but the entry is reaped all the same.
    expect(spawner.handle(1).killCount).toBe(0);
    const response = await app.inject(sizeRequest(alpha.id, { cols: 90, rows: 30 }, cookie));
    expect(response.statusCode).toBe(404);
  });

  it('refuses a non-allowlisted project without spawning a shell', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const outside = path.join(sandbox.dir, 'outside');
    await mkdir(outside, { recursive: true });
    const outsideId = Buffer.from(await realpath(outside), 'utf8').toString('base64url');

    const client = await connect(port, cookie, outsideId);

    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1008 });
    expect(spawner.spawns).toHaveLength(0);
  });

  it('refuses a connection that names no project at all', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);

    const client = await connect(port, cookie, undefined);

    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1008 });
    expect(spawner.spawns).toHaveLength(0);
  });

  it('replaces the shell on reconnect, and a stale socket neither hijacks nor kills the new one', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const first = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    const second = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(2);

    // A second connection is a fresh shell: the first handle was killed.
    expect(spawner.spawns).toHaveLength(2);
    expect(spawner.handle(1).killCount).toBe(1);

    // The stale socket’s bytes must not reach the live shell.
    first.send('stale');
    second.send('live');
    await until(() => spawner.handle(2).written.length === 1);
    expect(spawner.handle(2).written).toEqual(['live']);

    // Closing the stale socket must not kill the live shell.
    first.close();
    await first.waitForClose();
    second.send('after');
    await until(() => spawner.handle(2).written.length === 2);
    expect(spawner.handle(2).written).toEqual(['live', 'after']);
    expect(spawner.handle(2).killCount).toBe(0);
    second.close();
  });

  it('does not throw or double-close when a disconnected socket’s shell then exits', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    client.close();
    await client.waitForClose();
    await until(() => spawner.handle(1).killCount === 1);

    // A pty reporting its own exit after the client left is normal and must be
    // swallowed — and it must not kill a second time.
    expect(() => spawner.handle(1).exit(0)).not.toThrow();
    expect(spawner.handle(1).killCount).toBe(1);
  });

  it('gives a fresh shell on reconnect, never the reused one', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const first = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);
    first.close();
    await first.waitForClose();
    await until(() => spawner.handle(1).killCount === 1);

    const second = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(2);

    expect(spawner.spawns).toHaveLength(2);
    expect(spawner.handle(2)).not.toBe(spawner.handle(1));
    // The new socket is wired to the new shell.
    spawner.handle(2).emitData('fresh');
    await expect(second.next()).resolves.toBe('fresh');
    second.close();
  });

  it('resizes the project’s current shell through the size endpoint', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    const response = await app.inject(sizeRequest(alpha.id, { cols: 120, rows: 40 }, cookie));

    expect(response.statusCode).toBe(200);
    expect(spawner.handle(1).resizes).toEqual([{ cols: 120, rows: 40 }]);
    client.close();
  });

  it('answers 404 when the project has no terminal', async () => {
    const { app, spawner, cookie } = await makeApp();
    await listen(app);
    const alpha = await project('alpha');

    const response = await app.inject(sizeRequest(alpha.id, { cols: 120, rows: 40 }, cookie));

    expect(response.statusCode).toBe(404);
    expect(spawner.spawns).toHaveLength(0);
  });

  it('answers 404 for a project that is not allowlisted, in the same shape as the session routes', async () => {
    const { app, cookie } = await makeApp();
    await listen(app);
    const outside = path.join(sandbox.dir, 'outside');
    await mkdir(outside, { recursive: true });
    const outsideId = Buffer.from(await realpath(outside), 'utf8').toString('base64url');

    const response = await app.inject(sizeRequest(outsideId, { cols: 1, rows: 1 }, cookie));

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'no allowlisted project matches this id' });
  });

  it('answers 400 on a malformed body, without touching the shell', async () => {
    const { app, spawner, cookie } = await makeApp();
    const port = await listen(app);
    const alpha = await project('alpha');

    const client = await connect(port, cookie, alpha.id);
    await spawner.waitForSpawn(1);

    const malformed: Record<string, unknown>[] = [
      {},
      { cols: 120 },
      { cols: 'wide', rows: 40 },
      { cols: 0, rows: 40 },
      { cols: 1.5, rows: 2 },
      { cols: -1, rows: -1 },
    ];
    for (const body of malformed) {
      const response = await app.inject(sizeRequest(alpha.id, body, cookie));
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }

    // Nothing above resized the shell.
    expect(spawner.handle(1).resizes).toEqual([]);
    client.close();
  });

  /** The size-endpoint request for a project id — the body the client posts. */
  function sizeRequest(id: string, payload: Record<string, unknown>, cookie: string): InjectOptions {
    return {
      method: 'POST',
      url: `/api/projects/${encodeURIComponent(id)}/terminal/size`,
      payload,
      headers: { cookie },
    };
  }
});

/** A raw `ws` client: text frames in, text frames out, and the close code. */
interface RawClient {
  next(): Promise<string>;
  waitForClose(): Promise<{ code: number }>;
  send(data: string): void;
  close(): void;
}

function connect(port: number, cookie: string, projectId: string | undefined): Promise<RawClient> {
  const query = projectId === undefined ? '' : `?projectId=${encodeURIComponent(projectId)}`;
  // The session rides the handshake's headers — the browser sends the same
  // cookie on a same-origin upgrade with no client code at all.
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal${query}`, { headers: { cookie } });

  const queued: string[] = [];
  const readers: ((data: string) => void)[] = [];
  let closed: { code: number } | undefined;
  const closeReaders: ((info: { code: number }) => void)[] = [];

  socket.on('message', (data) => {
    // The transport is raw bytes: a frame is the payload verbatim, not JSON.
    const text = data.toString();
    const reader = readers.shift();
    if (reader === undefined) queued.push(text);
    else reader(text);
  });

  socket.on('close', (code) => {
    closed = { code };
    for (const reader of closeReaders.splice(0)) reader(closed);
  });

  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('open', () => {
      resolve({
        next() {
          const immediate = queued.shift();
          if (immediate !== undefined) return Promise.resolve(immediate);
          return new Promise<string>((reader) => readers.push(reader));
        },
        waitForClose() {
          if (closed !== undefined) return Promise.resolve(closed);
          return new Promise((reader) => closeReaders.push(reader));
        },
        send(data) {
          socket.send(data);
        },
        close() {
          socket.close();
        },
      });
    });
  });
}

/**
 * Park until `check` is true. The transport's server-side effects (a write
 * reaching the pty, a close killing it) land a tick after the client's frame, so
 * tests wait on the *observed* state rather than a fixed sleep.
 */
async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
