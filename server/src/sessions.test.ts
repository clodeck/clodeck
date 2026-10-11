import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { SessionMessage, SessionSummary } from '@clodeck/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { createProjectDiscovery } from './discovery.js';
import { createSandbox, createTestAuth, login, removeSandbox, type Sandbox } from './test-support.js';
import { createFakePtySpawner } from './testing/fake-pty.js';
import { createFakeProvider, type FakeProviderOptions } from './testing/fake-provider.js';

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

  function makeApp(options: FakeProviderOptions = {}): FastifyInstance {
    const app = buildApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      provider: createFakeProvider(options),
      // The terminal seam is injected even though these routes never spawn.
      spawner: createFakePtySpawner(),
      auth: createTestAuth(),
      // This suite is not about the bundle: no client is served.
      webRoot: null,
    });
    apps.push(app);
    return app;
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

    const response = await authed(makeApp({ sessions }), {
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

    const response = await authed(makeApp({ sessions }), {
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

    const response = await authed(makeApp(), {
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

    const response = await authed(makeApp({ sessionMessages: messages }), {
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

    const response = await authed(makeApp({ sessionMessages: [] }), {
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

    const response = await authed(makeApp(), {
      method: 'GET',
      url: `/api/projects/${escaping}/sessions/s1/messages`,
    });

    expect(response.statusCode).toBe(404);
    expect(Object.keys(response.json() as object)).toEqual(['error']);
  });
});
