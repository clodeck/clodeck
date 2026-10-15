import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { ApprovalRequestPayload, ServerEvent, SDKMessage } from '@clodeck/shared';

import type { AppOptions } from '../app.js';
import { createProjectDiscovery } from '../discovery.js';
import { createProviderProfiles } from '../profiles.js';
import {
  createSandbox,
  createTestApp,
  listen,
  login,
  removeSandbox,
  type Sandbox,
} from '../test-support.js';
import { createFakeProvider, type FakeProvider, type FakeProviderOptions } from '../testing/fake-provider.js';

/**
 * The `/ws` bus is the second agreed seam (spec-02 §Testing): a real socket on
 * an ephemeral loopback port, driven end to end against the scripted fake — no
 * SDK, no API key, no external network. Every assertion reads the wire envelope,
 * never the bus's internals.
 */
describe('the /ws event bus', () => {
  let sandbox: Sandbox;
  let root: string;
  let apps: FastifyInstance[];

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-bus-');
    root = sandbox.root;
    apps = [];
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await removeSandbox(sandbox);
  });

  /**
   * An app, its provider, and the `cookie` header its socket handshakes need —
   * logged in through the real route, because the gate fronts `/ws` and has no
   * bypass (spec-05 §Testing).
   *
   * `overrides` is how a suite that is *about* something else the app holds —
   * the profiles, the run log — says so without a second factory.
   */
  async function makeApp(
    options: FakeProviderOptions = {},
    overrides: Partial<AppOptions> = {},
  ): Promise<{ app: FastifyInstance; provider: FakeProvider; cookie: string }> {
    const provider = createFakeProvider(options);
    const app = createTestApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      provider,
      ...overrides,
    });
    apps.push(app);
    return { app, provider, cookie: await login(app) };
  }

  /** The id the wire carries: base64url of the canonical directory. */
  function idFor(directory: string): string {
    return Buffer.from(directory, 'utf8').toString('base64url');
  }

  it('closes the socket with an unknown_project error when the id is not allowlisted', async () => {
    const { app, cookie } = await makeApp();
    const port = await listen(app);
    const outside = idFor(path.join(sandbox.dir, 'outside'));

    const client = await connect(port, cookie, outside);

    await expect(client.next()).resolves.toMatchObject({
      kind: 'error',
      payload: { code: 'unknown_project' },
    });
    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1008 });
  });

  it('closes a connection that names no project at all', async () => {
    const { app, cookie } = await makeApp();
    const port = await listen(app);

    const client = await connect(port, cookie, undefined);

    await expect(client.next()).resolves.toMatchObject({
      kind: 'error',
      payload: { code: 'unknown_project' },
    });
    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1008 });
  });

  it('opens every connection with a snapshot of the project run state', async () => {
    await mkdir(path.join(root, 'alpha'));
    const { app, cookie } = await makeApp();
    const port = await listen(app);
    const projectId = await projectIdFor(path.join(root, 'alpha'));

    const client = await connect(port, cookie, projectId);
    const event = await client.next();

    expect(event).toMatchObject({ kind: 'snapshot', seq: 1, projectId });
    // `ts` is ISO 8601 — parsing and re-serializing is the round trip the client makes.
    expect(event.ts).toBe(new Date(event.ts).toISOString());
    if (event.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${event.kind}`);
    expect(event.payload).toEqual({
      state: 'idle',
      blocks: [],
      pendingApprovals: [],
      lastSeq: 0,
    });
  });

  it('streams one turn: turn_started, every SDK message in order, then turn_ended', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);
    const projectId = idFor(cwd);

    const client = await connect(port, cookie, projectId);
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });

    const started = await client.next();
    expect(started).toMatchObject({
      kind: 'stream_status',
      seq: 2,
      projectId,
      payload: { status: 'turn_started' },
    });
    // The turn starts before the SDK has named a session, so there is none yet.
    expect(started.sessionId).toBeUndefined();
    const turnId = started.turnId;
    expect(typeof turnId).toBe('string');

    const streamed = [await client.next(), await client.next(), await client.next(), await client.next()];
    const ended = await client.next();

    expect(ended).toMatchObject({ kind: 'stream_status', payload: { status: 'turn_ended' } });
    // The whole turn shares one turnId, and one monotonic sequence.
    expect([...streamed, ended].every((event) => event.turnId === turnId)).toBe(true);
    expect([started, ...streamed, ended].map((event) => event.seq)).toEqual([2, 3, 4, 5, 6, 7]);

    // Every mirrored message reached the wire unmodified, in order.
    expect(streamed.map((event) => event.kind)).toEqual(['sdk', 'sdk', 'sdk', 'sdk']);
    expect(streamed.map((event) => (event.kind === 'sdk' ? event.payload : null))).toEqual(
      transcript(cwd),
    );
    // The session id is captured from the init before its own event is sent.
    expect(streamed[0]?.sessionId).toBe(SESSION_ID);

    // The run was driven against the canonical directory named by the id.
    expect(provider.queryInputs[0]).toMatchObject({ cwd, prompt: 'hello' });
  });

  it('rejects a second send_prompt while a turn is running, without a second query', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'first' } });
    await client.nextMatching((event) => event.kind === 'stream_status');
    // The run exists — and is held open, so the project is still running.
    await provider.waitForQueryInput(1);

    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'second' } });

    const error = await client.nextMatching((event) => event.kind === 'error');
    expect(error).toMatchObject({ projectId: idFor(cwd), payload: { code: 'turn_in_progress' } });
    // The model is never double-driven: the rejected send made no query().
    expect(provider.queryInputs).toHaveLength(1);

    provider.releaseRuns();
  });

  it('interrupts the active turn and reports it with stream_status: interrupted', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
    const started = await client.nextMatching((event) => event.kind === 'stream_status');
    await provider.waitForQueryInput(1);

    client.send({ v: 1, id: 'c2', type: 'interrupt', payload: {} });

    // The run's own interrupt() is what stops it — not a bus-local flag.
    await provider.waitForInterrupt(1);
    expect(provider.interruptCount).toBe(1);
    const interrupted = await client.nextMatching((event) => event.kind === 'stream_status');
    expect(interrupted).toMatchObject({
      payload: { status: 'interrupted' },
      turnId: started.turnId,
    });

    provider.releaseRuns();
  });

  it('drives the active run’s permission mode when set_permission_mode arrives', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
    await client.nextMatching((event) => event.kind === 'stream_status');
    await provider.waitForQueryInput(1);

    client.send({ v: 1, id: 'c2', type: 'set_permission_mode', payload: { mode: 'plan' } });

    await expect(provider.waitForPermissionMode(1)).resolves.toBe('plan');
    provider.releaseRuns();
  });

  it('reports no_active_turn when set_permission_mode arrives with no turn running', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp();
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'set_permission_mode', payload: { mode: 'plan' } });

    const error = await client.nextMatching((event) => event.kind === 'error');
    expect(error).toMatchObject({ payload: { code: 'no_active_turn' } });
    expect(provider.permissionModes).toEqual([]);
  });

  it('round-trips a gated tool: approval_request out, approval_response back', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
    await client.nextMatching((event) => event.kind === 'stream_status');
    await provider.waitForQueryInput(1);

    // The SDK's side of the tool gate, driven from outside the run.
    const answer = provider.requestApproval(APPROVAL_REQUEST);
    const request = await client.nextMatching((event) => event.kind === 'approval_request');
    expect(request).toMatchObject({ projectId: idFor(cwd), payload: APPROVAL_REQUEST });

    client.send({
      v: 1,
      id: 'c2',
      type: 'approval_response',
      payload: {
        requestId: APPROVAL_REQUEST.requestId,
        behavior: 'allow',
        updatedInput: { command: 'ls -la' },
        updatedPermissions: [{ allow: 'Bash' }],
      },
    });

    // The response reaches the run untouched: allow-with-edits and the echoed
    // permissions are the payload's, not a re-built shape.
    await expect(answer).resolves.toEqual({
      requestId: APPROVAL_REQUEST.requestId,
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
      updatedPermissions: [{ allow: 'Bash' }],
    });
    provider.releaseRuns();
  });

  it('round-trips a gated AskUserQuestion through the same approval path', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'build me a thing' } });
    await client.nextMatching((event) => event.kind === 'stream_status');
    await provider.waitForQueryInput(1);

    // A clarifying question is a `canUseTool` gate like any other tool. Ticket
    // 08 names AskUserQuestion specifically, so it is proven by a test that
    // names it rather than by the callback being tool-name-agnostic.
    const answer = provider.requestApproval(QUESTION_REQUEST);
    const request = await client.nextMatching((event) => event.kind === 'approval_request');
    expect(request).toMatchObject({ projectId: idFor(cwd), payload: QUESTION_REQUEST });
    if (request.kind !== 'approval_request') {
      throw new Error(`expected an approval_request, got ${request.kind}`);
    }
    expect(request.payload.toolName).toBe('AskUserQuestion');

    // The UI renders the questions and returns the answers as the input — the
    // `AskUserQuestion` shape from research 01 §5.
    client.send({
      v: 1,
      id: 'c2',
      type: 'approval_response',
      payload: {
        requestId: QUESTION_REQUEST.requestId,
        behavior: 'allow',
        updatedInput: {
          questions: QUESTION_REQUEST.input['questions'],
          answers: { 'Which database should I use?': 'Postgres' },
        },
      },
    });

    await expect(answer).resolves.toEqual({
      requestId: QUESTION_REQUEST.requestId,
      behavior: 'allow',
      updatedInput: {
        questions: QUESTION_REQUEST.input['questions'],
        answers: { 'Which database should I use?': 'Postgres' },
      },
    });
    provider.releaseRuns();
  });

  it('answers an approval_response whose requestId matches no pending request', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, cookie } = await makeApp();
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({
      v: 1,
      id: 'c1',
      type: 'approval_response',
      payload: { requestId: 'never-asked', behavior: 'deny' },
    });

    const error = await client.nextMatching((event) => event.kind === 'error');
    expect(error).toMatchObject({ payload: { code: 'invalid_message' } });
  });

  it('rebuilds a reconnecting socket from the snapshot, complete blocks and pending approvals', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);
    const projectId = idFor(cwd);

    const first = await connect(port, cookie, projectId);
    await first.next(); // the snapshot
    first.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
    await first.nextMatching((event) => event.kind === 'stream_status');
    await provider.waitForQueryInput(1);
    // The complete assistant block has been recorded (deltas are not blocks).
    await first.nextMatching((event) => event.kind === 'sdk' && event.payload.type === 'assistant');

    const answer = provider.requestApproval(APPROVAL_REQUEST);
    await first.nextMatching((event) => event.kind === 'approval_request');
    first.close();
    await first.waitForClose();

    const second = await connect(port, cookie, projectId);
    const snapshot = await second.next();

    expect(snapshot).toMatchObject({ kind: 'snapshot', seq: 1, projectId, sessionId: SESSION_ID });
    expect(typeof snapshot.turnId).toBe('string');
    if (snapshot.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${snapshot.kind}`);
    expect(snapshot.payload.state).toBe('requires_action');
    expect(snapshot.payload.lastSeq).toBe(0);
    // Complete messages only, in order — the buffered delta is never replayed.
    expect(snapshot.payload.blocks).toEqual(
      partialTranscript(cwd).filter((message) => message.type !== 'stream_event'),
    );
    expect(snapshot.payload.pendingApprovals).toEqual([APPROVAL_REQUEST]);

    // The outstanding approval is answerable on the new socket.
    second.send({
      v: 1,
      id: 'c2',
      type: 'approval_response',
      payload: { requestId: APPROVAL_REQUEST.requestId, behavior: 'deny', message: 'not now' },
    });
    await expect(answer).resolves.toEqual({
      requestId: APPROVAL_REQUEST.requestId,
      behavior: 'deny',
      message: 'not now',
    });
    provider.releaseRuns();
  });

  it('applies a continue target to the next send and consumes it', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'resume', payload: { mode: 'continue' } });
    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'one' } });

    const first = await provider.waitForQueryInput(1);
    // `resume` sent no prompt of its own; the send that followed carried it.
    expect(first).toMatchObject({ prompt: 'one', continueLatest: true });
    expect('resume' in first).toBe(false);

    await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
    );
    client.send({ v: 1, id: 'c3', type: 'send_prompt', payload: { prompt: 'two' } });

    const second = await provider.waitForQueryInput(2);
    // The target applied once and was consumed.
    expect(second).toMatchObject({ prompt: 'two' });
    expect(second.continueLatest).toBeUndefined();
    expect(second.resume).toBeUndefined();
  });

  it('applies a named resume, with fork, to the next send', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'resume', payload: { sessionId: 'sess-42', fork: true } });
    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'go' } });

    await expect(provider.waitForQueryInput(1)).resolves.toMatchObject({
      resume: 'sess-42',
      forkSession: true,
    });
  });

  it('answers invalid_message to a malformed frame and keeps the socket alive', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot

    // Unparseable JSON, an unknown type, a payload missing a required field, and
    // a profile that is not a name all land on the same answer.
    const malformed: unknown[] = [
      'this is not json',
      { v: 1, id: 'c1', type: 'no_such_type', payload: {} },
      { v: 1, id: 'c2', type: 'send_prompt', payload: {} },
      // A profile is a name and nothing else; a richer object is a frame this
      // server does not understand rather than a name it can refuse.
      { v: 1, id: 'c3', type: 'send_prompt', payload: { prompt: 'hi', profile: { name: 'FAST' } } },
    ];
    for (const [index, frame] of malformed.entries()) {
      if (typeof frame === 'string') client.sendRaw(frame);
      else client.send(frame);
      const error = await client.nextMatching((event) => event.kind === 'error');
      expect(error, `frame ${index}`).toMatchObject({ payload: { code: 'invalid_message' } });
    }

    // Nothing above closed or wedged the socket.
    client.send({ v: 1, id: 'c4', type: 'send_prompt', payload: { prompt: 'still here' } });
    const started = await client.nextMatching((event) => event.kind === 'stream_status');
    expect(started).toMatchObject({ payload: { status: 'turn_started' } });
    await expect(provider.waitForQueryInput(1)).resolves.toMatchObject({ prompt: 'still here' });
  });

  it('reports an internal error when a run fails before its result, and returns to idle', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, cookie } = await makeApp({ messages: partialTranscript(cwd), failRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });

    const error = await client.nextMatching((event) => event.kind === 'error');
    expect(error).toMatchObject({ payload: { code: 'internal' } });

    // The failed turn released the project: another send starts a fresh turn.
    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'again' } });
    const restarted = await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_started',
    );
    expect(restarted).toMatchObject({ payload: { status: 'turn_started' } });
  });

  it('treats a throw after the result as noise', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, cookie } = await makeApp({ messages: transcript(cwd), failRuns: true });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
    await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
    );

    // The very next frame is the following turn's start — no internal error
    // slipped in for a throw the SDK makes after an error result.
    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'again' } });
    await expect(client.next()).resolves.toMatchObject({
      kind: 'stream_status',
      payload: { status: 'turn_started' },
    });
  });

  it('returns the project to idle when the run cannot even start', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp();
    // A provider that fails synchronously is the one path the scripted fake does
    // not model, so it is scripted here — the assertion is still the wire's.
    provider.query = () => {
      throw new Error('cannot start');
    };
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });

    const error = await client.nextMatching((event) => event.kind === 'error');
    expect(error).toMatchObject({ payload: { code: 'internal' } });

    // The project is idle again, not wedged as running: a second send starts a
    // fresh turn rather than being rejected as turn_in_progress.
    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'again' } });
    await expect(client.nextMatching((event) => event.kind === 'stream_status')).resolves.toMatchObject(
      { payload: { status: 'turn_started' } },
    );
  });

  describe('the provider a turn runs on', () => {
    /** A server with a provider of its own, and one extra tier declared beside it. */
    const ENV: NodeJS.ProcessEnv = {
      ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'server-credential',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5',
      // A profile that names a host of its own — a *provider* — so the pin's own
      // case has one to be asked for and refused.
      CLODECK_PROVIDER_VENDOR_BASE_URL: 'https://vendor.example/anthropic',
    };

    /** An app whose profiles are that environment — read once, as boot does. */
    function withProfiles(
      options: FakeProviderOptions = {},
      log?: (line: string) => void,
    ): ReturnType<typeof makeApp> {
      const profiles = createProviderProfiles(ENV, () => undefined);
      return makeApp(options, log === undefined ? { profiles } : { profiles, log });
    }

    /**
     * A project directory, with a `.claude/settings.json` holding `settings` —
     * which is what makes a project pin its provider. Called without one, it
     * makes a project that pins nothing at all, settings file included.
     */
    async function project(name: string, settings?: unknown): Promise<string> {
      const dir = path.join(root, name);
      await mkdir(path.join(dir, '.claude'), { recursive: true });
      if (settings !== undefined) {
        await writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
      }
      return realpath(dir);
    }

    /** One send on `profile`, from a socket bound to `cwd`. */
    async function send(
      cwd: string,
      profile: string,
      log?: (line: string) => void,
    ): Promise<FakeProvider> {
      const { app, provider, cookie } = await withProfiles({}, log);
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello', profile } });
      await provider.waitForQueryInput(1);
      return provider;
    }

    it('runs the turn on the chosen profile: its endpoint, its credential and its model', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await withProfiles();
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello', profile: 'FAST' } });
      await provider.waitForQueryInput(1);

      // The tier inherits the endpoint and the credential, and brings its own
      // model: one source per key, and the whole trio resolved before the run.
      expect(provider.queryInputs[0]?.provider).toEqual({
        baseUrl: 'https://gateway.example/anthropic',
        authToken: 'server-credential',
        model: 'claude-haiku-5-5',
      });
    });

    it('runs a send that names no profile on the reserved default — the server’s own environment', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await withProfiles();
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
      await provider.waitForQueryInput(1);

      expect(provider.queryInputs[0]?.provider).toEqual({
        baseUrl: 'https://gateway.example/anthropic',
        authToken: 'server-credential',
        model: 'claude-opus-5-5',
      });
    });

    it('refuses an unknown or stale name visibly, and starts no run at all', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await withProfiles();
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello', profile: 'GONE' } });

      const error = await client.nextMatching((event) => event.kind === 'error');
      expect(error).toMatchObject({ projectId: idFor(cwd), payload: { code: 'unknown_profile' } });
      // The client is told which profile it asked for — never quietly given the
      // default, which would be a turn on a provider nobody chose.
      expect(error.kind === 'error' ? error.payload.message : '').toContain('GONE');

      // Nothing ran, and the project is not wedged: the next send starts a turn.
      client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'again', profile: 'FAST' } });
      await expect(provider.waitForQueryInput(1)).resolves.toMatchObject({ prompt: 'again' });
      expect(provider.queryInputs).toHaveLength(1);
    });

    it('records which profile and model every run used', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const lines: string[] = [];
      const { app, provider, cookie } = await withProfiles({}, (line) => lines.push(line));
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello', profile: 'FAST' } });
      await provider.waitForQueryInput(1);

      // One line per run, and it names both halves of "what did that turn run
      // on" — the choice a person made, and the model it came to.
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('FAST');
      expect(lines[0]).toContain('claude-haiku-5-5');
      expect(lines[0]).toContain(cwd);
    });

    it('sends the model alone in a project that pins its provider, however the client asks', async () => {
      // The project declares its own endpoint and credential …
      const cwd = await project('pinned', {
        env: {
          ANTHROPIC_BASE_URL: 'https://vendor.example/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'project-credential',
        },
      });

      // … and the client asks for the *provider*-shaped profile, the one whose
      // endpoint and credential are its own. A tampered client is the case the
      // rule is enforced for, so this is a request the server must survive
      // without ever producing a mixed pair.
      const provider = await send(cwd, 'VENDOR');
      await provider.waitForQueryInput(1);

      // The model travels free; the endpoint and the credential both stay the
      // project's. Sending the profile's pair here is what the ADR forbids, and
      // `provider` being the trio minus its two would be the leak.
      expect(provider.queryInputs[0]?.provider).toEqual({ model: 'claude-opus-5-5' });
    });

    it('sends the whole trio in a project that declares only a model, since a model is not a pin', async () => {
      const cwd = await project('model-only', { env: { ANTHROPIC_MODEL: 'project-model' } });
      const provider = await send(cwd, 'FAST');

      // The file's model is what the project asks for by default, and the run's
      // is what the session chose: `Options.env` outranks the file for a key it
      // names, which is exactly why the model can travel while the pair cannot.
      expect(provider.queryInputs[0]?.provider).toEqual({
        baseUrl: 'https://gateway.example/anthropic',
        authToken: 'server-credential',
        model: 'claude-haiku-5-5',
      });
    });

    it('records what a pinned project’s turn sent and what its pin kept, and never a credential', async () => {
      const cwd = await project('pinned-log', { env: { ANTHROPIC_AUTH_TOKEN: 'project-credential' } });
      const lines: string[] = [];
      await send(cwd, 'FAST', (line) => lines.push(line));

      // "What did that turn run on" has two halves once a project can outrank a
      // choice, and the line carries both: the model it went out with, and the
      // keys the file kept — with the reason, in one phrase.
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('FAST');
      expect(lines[0]).toContain('claude-haiku-5-5');
      expect(lines[0]).toContain('sent: model');
      expect(lines[0]).toContain("kept by the project's pin: credential");
      // Named, never quoted: the record of every turn is not a place this server
      // writes a secret down.
      expect(lines[0]).not.toContain('project-credential');
      expect(lines[0]).not.toContain('server-credential');
    });

    it('records an unpinned turn as sending the whole trio, with no pin to report', async () => {
      // No `.claude` directory and no settings file: the project that pins
      // nothing, which is ticket 68's case and still behaves as it did.
      await mkdir(path.join(root, 'plain'));
      const cwd = await realpath(path.join(root, 'plain'));
      const lines: string[] = [];
      await send(cwd, 'FAST', (line) => lines.push(line));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('sent: endpoint, credential, model');
      expect(lines[0]).not.toContain('pin');
    });
  });

  /** The id the wire carries for a directory: base64url of its canonical path. */
  async function projectIdFor(directory: string): Promise<string> {
    return idFor(await realpath(directory));
  }

});

/** One scripted turn's messages, replayed by the fake provider on every `query()`. */
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

/** A tool gate the fake provider can raise from outside the run. */
const APPROVAL_REQUEST: ApprovalRequestPayload = {
  requestId: 'req-1',
  toolUseID: 'tool-1',
  toolName: 'Bash',
  input: { command: 'ls' },
  title: 'Claude wants to run Bash',
  displayName: 'Run Bash',
};

/**
 * The clarifying-question gate: ticket 08 names `AskUserQuestion` alongside every
 * other gated tool, and its input/answer shape differs from a plain tool call
 * (research 01 §5), so it is driven end to end here rather than assumed.
 */
const QUESTION_REQUEST: ApprovalRequestPayload = {
  requestId: 'req-q1',
  toolUseID: 'tool-q1',
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: 'Which database should I use?',
        header: 'Database',
        options: [
          { label: 'Postgres', description: 'A relational server' },
          { label: 'SQLite', description: 'An embedded file' },
        ],
        multiSelect: false,
      },
    ],
  },
  title: 'Claude has a question',
  displayName: 'Answer a question',
};

function transcript(cwd: string): SDKMessage[] {
  return [
    {
      type: 'system',
      subtype: 'init',
      session_id: SESSION_ID,
      cwd,
      model: 'fake-provider',
      permissionMode: 'default',
      tools: ['Read'],
    },
    {
      type: 'stream_event',
      session_id: SESSION_ID,
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' },
      },
    },
    {
      type: 'assistant',
      session_id: SESSION_ID,
      parent_tool_use_id: null,
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    },
    {
      type: 'result',
      subtype: 'success',
      session_id: SESSION_ID,
      is_error: false,
      result: 'hi',
      num_turns: 1,
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      duration_ms: 1,
    },
  ];
}

/**
 * A turn that is still streaming: the same opening messages but no `result`, so
 * nothing ends it and a holding provider can keep it in flight.
 */
function partialTranscript(cwd: string): SDKMessage[] {
  return transcript(cwd).slice(0, 3);
}

/**
 * A thin `ws` client that hands back parsed `ServerEvent`s in arrival order, so
 * a test reads the wire the way the browser will. Frames are queued until asked
 * for, which keeps a test from racing the server.
 */
interface BusClient {
  next(): Promise<ServerEvent>;
  /** Reads (and discards) frames until one satisfies `predicate` — for a frame that follows a known burst. */
  nextMatching(predicate: (event: ServerEvent) => boolean): Promise<ServerEvent>;
  waitForClose(): Promise<{ code: number }>;
  send(message: unknown): void;
  /** A frame exactly as given — for the bytes that are not valid JSON. */
  sendRaw(text: string): void;
  close(): void;
}

function connect(port: number, cookie: string, projectId: string | undefined): Promise<BusClient> {
  const query = projectId === undefined ? '' : `?projectId=${encodeURIComponent(projectId)}`;
  const url = `ws://127.0.0.1:${port}/ws${query}`;
  // The session rides the handshake's headers — the browser sends the same
  // cookie on a same-origin upgrade with no client code at all.
  const socket = new WebSocket(url, { headers: { cookie } });

  const queued: ServerEvent[] = [];
  const readers: ((event: ServerEvent) => void)[] = [];
  let closed: { code: number } | undefined;
  const closeReaders: ((info: { code: number }) => void)[] = [];

  socket.on('message', (data) => {
    const event = JSON.parse(data.toString()) as ServerEvent;
    const reader = readers.shift();
    if (reader === undefined) queued.push(event);
    else reader(event);
  });

  socket.on('close', (code) => {
    closed = { code };
    for (const reader of closeReaders.splice(0)) reader(closed);
  });

  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('open', () => {
      const next = () => {
        const immediate = queued.shift();
        if (immediate !== undefined) return Promise.resolve(immediate);
        return new Promise<ServerEvent>((reader) => readers.push(reader));
      };

      resolve({
        next,
        async nextMatching(predicate) {
          for (;;) {
            const event = await next();
            if (predicate(event)) return event;
          }
        },
        waitForClose() {
          if (closed !== undefined) return Promise.resolve(closed);
          return new Promise((reader) => closeReaders.push(reader));
        },
        send(message) {
          socket.send(JSON.stringify(message));
        },
        sendRaw(text) {
          socket.send(text);
        },
        close() {
          socket.close();
        },
      });
    });
  });
}
