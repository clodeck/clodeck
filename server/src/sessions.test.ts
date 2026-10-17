import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { SDKMessage, ServerEvent, SessionMessage, SessionSummary } from '@clodeck/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createProjectDiscovery } from './discovery.js';
import {
  createSandbox,
  createTestApp,
  listen,
  login,
  removeSandbox,
  type Sandbox,
} from './test-support.js';
import { createFakeProvider, type FakeProvider, type FakeProviderOptions } from './testing/fake-provider.js';

/**
 * Session history is asserted where the web clients consume it — the HTTP
 * boundary — so the exact envelope shape, the ordering rule and the 404 are the
 * endpoint's *external* behavior, pinned against a real route and the scripted
 * provider. No private function is reached into and the SDK is never loaded.
 */
describe('the session-history API', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-sessions-');
    root = sandbox.root;
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  function makeApp(options: FakeProviderOptions = {}): {
    app: FastifyInstance;
    provider: FakeProvider;
  } {
    const provider = createFakeProvider(options);
    const app = createTestApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      // The transcript this suite is about; the pty seam is the factory's, even
      // though these routes never spawn.
      provider,
    });
    apps.push(app);
    return { app, provider };
  }

  /**
   * One authenticated request. Every route in this suite sits behind the gate,
   * so the session cookie belongs to the request's *shape* rather than to a line
   * each assertion repeats — and the login is the real route, because the gate
   * has no bypass to reach for.
   */
  async function authed(app: FastifyInstance, options: InjectOptions): Promise<LightMyRequestResponse> {
    return app.inject({ ...options, headers: { ...options.headers, cookie: await login(app) } });
  }

  /** The id of a project directory, minted the way the discovery seam mints it. */
  async function projectId(name: string): Promise<string> {
    await mkdir(path.join(root, name), { recursive: true });
    const projects = await createProjectDiscovery(root, { warn: () => undefined }).listProjects();
    const project = projects.find((candidate) => candidate.name === name);
    if (project === undefined) throw new Error(`the sandbox has no project named ${name}`);
    return project.id;
  }

  it('serves the provider sessions at GET /api/projects/:id/sessions', async () => {
    const sessions: SessionSummary[] = [{ id: 's1', title: 'First session' }];
    const id = await projectId('alpha');

    const response = await authed(makeApp({ sessions }).app, {
      method: 'GET',
      url: `/api/projects/${id}/sessions`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessions });
  });

  it('orders sessions by lastModified descending, missing last, equal keys stable', async () => {
    // The provider's own order is deliberately not the expected order, so the
    // endpoint — not the provider — is what the assertion is pinning.
    const sessions: SessionSummary[] = [
      { id: 'untitled', title: 'Untitled' },
      { id: 'older', title: 'Older', lastModified: '2024-01-01T00:00:00.000Z' },
      { id: 'newer', title: 'Newer', lastModified: '2024-06-01T00:00:00.000Z' },
      { id: 'tie-a', title: 'Tie A', lastModified: '2024-03-01T00:00:00.000Z' },
      { id: 'tie-b', title: 'Tie B', lastModified: '2024-03-01T00:00:00.000Z' },
    ];
    const id = await projectId('alpha');

    const response = await authed(makeApp({ sessions }).app, {
      method: 'GET',
      url: `/api/projects/${id}/sessions`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { sessions: SessionSummary[] };
    // Newest first; a session with no timestamp after every session that has
    // one; the two equal keys keep the provider's order (tie-a before tie-b).
    expect(body.sessions.map((session) => session.id)).toEqual([
      'newer',
      'tie-a',
      'tie-b',
      'older',
      'untitled',
    ]);
    // A title the provider already normalized — including the `"Untitled"`
    // fallback — reaches the client unchanged; the route never re-derives one.
    expect(body.sessions.map((session) => session.title)).toContain('Untitled');
  });

  it('answers 404 with the { error } envelope for an id the allowlist rejects', async () => {
    // A real directory, but outside the projects root — so the id decodes to a
    // path yet must still be refused (decoding an id is never authorization).
    await mkdir(path.join(sandbox.dir, 'outside'));
    const escaping = Buffer.from(path.join(sandbox.dir, 'outside'), 'utf8').toString('base64url');

    const response = await authed(makeApp().app, {
      method: 'GET',
      url: `/api/projects/${escaping}/sessions`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: string };
    // The server's one REST error shape — an `{ error }` object, nothing else.
    expect(Object.keys(body)).toEqual(['error']);
    expect(typeof body.error).toBe('string');
  });

  it('serves a transcript of complete blocks at GET .../:sid/messages', async () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'list the files' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should run ls' },
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
        ],
        toolUseId: 'toolu_1',
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt' }],
        toolUseId: 'toolu_1',
      },
    ];
    const id = await projectId('alpha');

    const response = await authed(makeApp({ sessionMessages: messages }).app, {
      method: 'GET',
      url: `/api/projects/${id}/sessions/s1/messages`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { messages: SessionMessage[] };
    expect(Object.keys(body)).toEqual(['messages']);
    // Complete blocks pass through untouched — the same `ContentBlock`s a live
    // turn carries, so live and history share one renderer.
    expect(body.messages).toEqual(messages);
    const blockKinds = body.messages.flatMap((message) =>
      message.content.map((block) => block.type),
    );
    // History is static: a transcript never carries a live `stream_event` delta.
    expect(blockKinds).not.toContain('stream_event');
  });

  it('answers 200 { messages: [] } for a session the provider does not know', async () => {
    const id = await projectId('alpha');

    const response = await authed(makeApp({ sessionMessages: [] }).app, {
      method: 'GET',
      url: `/api/projects/${id}/sessions/never-heard-of-it/messages`,
    });

    // No session store of its own: a miss is an empty transcript, not an error.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messages: [] });
  });

  it('guards the transcript with the same allowlist 404 as the list', async () => {
    await mkdir(path.join(sandbox.dir, 'outside'));
    const escaping = Buffer.from(path.join(sandbox.dir, 'outside'), 'utf8').toString('base64url');

    const response = await authed(makeApp().app, {
      method: 'GET',
      url: `/api/projects/${escaping}/sessions/s1/messages`,
    });

    expect(response.statusCode).toBe(404);
    expect(Object.keys(response.json() as object)).toEqual(['error']);
  });

  describe('deleting a session', () => {
    it('removes the transcript from the provider, and it is gone from the next read', async () => {
      const sessions: SessionSummary[] = [
        { id: 'keep-me', title: 'Keep' },
        { id: 'delete-me', title: 'Delete' },
      ];
      const id = await projectId('alpha');
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider } = makeApp({ sessions });

      const deleted = await authed(app, {
        method: 'DELETE',
        url: `/api/projects/${id}/sessions/delete-me`,
      });

      expect(deleted.statusCode).toBe(204);
      expect(deleted.body).toBe('');
      // The provider's own argument pair — the session, and this project's
      // canonical directory, never a path assembled from the id.
      expect(provider.deletedSessions).toEqual([{ sessionId: 'delete-me', dir: cwd }]);

      const list = await authed(app, {
        method: 'GET',
        url: `/api/projects/${id}/sessions`,
      });
      expect((list.json() as { sessions: SessionSummary[] }).sessions.map((session) => session.id)).toEqual([
        'keep-me',
      ]);
    });

    it('answers 404 for a session the project does not list, and deletes nothing', async () => {
      const id = await projectId('alpha');
      const { app, provider } = makeApp({ sessions: [{ id: 'known', title: 'Known' }] });

      const response = await authed(app, {
        method: 'DELETE',
        url: `/api/projects/${id}/sessions/unknown`,
      });

      expect(response.statusCode).toBe(404);
      expect(Object.keys(response.json() as object)).toEqual(['error']);
      expect(provider.deletedSessions).toEqual([]);
    });

    it('answers 404 for a traversal-shaped id without touching the filesystem', async () => {
      const id = await projectId('alpha');
      // A file outside the project that the path-shaped id would aim at.
      await mkdir(path.join(sandbox.dir, 'outside'));
      const { app, provider } = makeApp({ sessions: [{ id: 'known', title: 'Known' }] });

      const response = await authed(app, {
        method: 'DELETE',
        url: `/api/projects/${id}/sessions/${encodeURIComponent('../outside/known')}`,
      });

      // Membership in the project's own list is the gate; a traversal shape is
      // simply not in it, and the provider is never told to delete anything.
      expect(response.statusCode).toBe(404);
      expect(provider.deletedSessions).toEqual([]);
    });

    it('answers 409 for the session a live turn is writing, and leaves it intact', async () => {
      const sessions: SessionSummary[] = [{ id: SESSION_ID, title: 'Running' }];
      const id = await projectId('alpha');
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider } = makeApp({
        sessions,
        messages: [initMessage(cwd)],
        holdRuns: true,
      });
      const port = await listen(app);
      const bus = await openBus(port, await login(app), id);

      try {
        await bus.next(); // the snapshot
        bus.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'go' } });
        // The init is the frame that names the session; until it lands a delete
        // would be free, and this test is about the window after it.
        await bus.nextMatching((event) => event.kind === 'sdk' && event.sessionId === SESSION_ID);

        const response = await authed(app, {
          method: 'DELETE',
          url: `/api/projects/${id}/sessions/${SESSION_ID}`,
        });

        expect(response.statusCode).toBe(409);
        expect((response.json() as { error: string }).error).toContain('turn_in_progress');
        // Nothing was removed: the run's transcript is still there to be written.
        expect(provider.deletedSessions).toEqual([]);
      } finally {
        provider.releaseRuns();
        bus.close();
      }
    });

    it('allows deleting an older session while a turn is running that has not named one', async () => {
      const sessions: SessionSummary[] = [{ id: 'older', title: 'Older' }];
      const id = await projectId('alpha');
      const cwd = await realpath(path.join(root, 'alpha'));
      // No messages: the run starts but the SDK names no session, so `older`
      // belongs to no live turn.
      const { app, provider } = makeApp({ sessions, holdRuns: true });
      const port = await listen(app);
      const bus = await openBus(port, await login(app), id);

      try {
        await bus.next(); // the snapshot
        bus.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'go' } });
        await provider.waitForQueryInput(1);

        const response = await authed(app, {
          method: 'DELETE',
          url: `/api/projects/${id}/sessions/older`,
        });

        expect(response.statusCode).toBe(204);
        expect(provider.deletedSessions).toEqual([{ sessionId: 'older', dir: cwd }]);
      } finally {
        provider.releaseRuns();
        bus.close();
      }
    });

    it('is behind the auth gate like every other route', async () => {
      const id = await projectId('alpha');
      const { app, provider } = makeApp({ sessions: [{ id: 's1', title: 'One' }] });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${id}/sessions/s1`,
      });

      expect(response.statusCode).toBe(401);
      expect(provider.deletedSessions).toEqual([]);
    });
  });
});

/** The session the scripted run opens with. */
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

/** The `init` a fake run opens with — the one frame that names its session. */
function initMessage(cwd: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: SESSION_ID,
    cwd,
    model: 'fake-provider',
    permissionMode: 'default',
    tools: ['Read'],
  };
}

/** A thin `/ws` client: frames are queued, so a test never races the server. */
interface BusConnection {
  send(message: unknown): void;
  next(): Promise<ServerEvent>;
  nextMatching(predicate: (event: ServerEvent) => boolean): Promise<ServerEvent>;
  close(): void;
}

function openBus(port: number, cookie: string, projectId: string): Promise<BusConnection> {
  const url = `ws://127.0.0.1:${String(port)}/ws?projectId=${encodeURIComponent(projectId)}`;
  const socket = new WebSocket(url, { headers: { cookie } });

  const queued: ServerEvent[] = [];
  const readers: ((event: ServerEvent) => void)[] = [];

  socket.on('message', (raw: unknown) => {
    const event = JSON.parse(String(raw)) as ServerEvent;
    const reader = readers.shift();
    if (reader === undefined) queued.push(event);
    else reader(event);
  });

  const next = (): Promise<ServerEvent> => {
    const event = queued.shift();
    if (event !== undefined) return Promise.resolve(event);
    return new Promise((resolve) => {
      readers.push(resolve);
    });
  };

  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve({
        send(message) {
          socket.send(JSON.stringify(message));
        },
        next,
        async nextMatching(predicate) {
          for (;;) {
            const event = await next();
            if (predicate(event)) return event;
          }
        },
        close() {
          socket.close();
        },
      });
    });
    socket.once('error', reject);
  });
}
