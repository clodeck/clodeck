import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { ApprovalRequestPayload, ServerEvent, SDKMessage } from '@clodeck/shared';

import { buildApp } from '../app.js';
import { createProjectDiscovery } from '../discovery.js';
import { createFakeProvider, type FakeProvider, type FakeProviderOptions } from '../testing/fake-provider.js';
import { createSandbox, removeSandbox, type Sandbox } from '../test-support.js';

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

  function makeApp(options: FakeProviderOptions = {}): { app: FastifyInstance; provider: FakeProvider } {
    const provider = createFakeProvider(options);
    const app = buildApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      provider,
    });
    apps.push(app);
    return { app, provider };
  }

  /** The id the wire carries: base64url of the canonical directory. */
  function idFor(directory: string): string {
    return Buffer.from(directory, 'utf8').toString('base64url');
  }

  it('closes the socket with an unknown_project error when the id is not allowlisted', async () => {
    const { app } = makeApp();
    const port = await listen(app);
    const outside = idFor(path.join(sandbox.dir, 'outside'));

    const client = await connect(port, outside);

    await expect(client.next()).resolves.toMatchObject({
      kind: 'error',
      payload: { code: 'unknown_project' },
    });
    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1008 });
  });

  it('closes a connection that names no project at all', async () => {
    const { app } = makeApp();
    const port = await listen(app);

    const client = await connect(port, undefined);

    await expect(client.next()).resolves.toMatchObject({
      kind: 'error',
      payload: { code: 'unknown_project' },
    });
    await expect(client.waitForClose()).resolves.toMatchObject({ code: 1008 });
  });

  it('opens every connection with a snapshot of the project run state', async () => {
    await mkdir(path.join(root, 'alpha'));
    const { app } = makeApp();
    const port = await listen(app);
    const projectId = await projectIdFor(path.join(root, 'alpha'));

    const client = await connect(port, projectId);
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
    const { app, provider } = makeApp({ messages: transcript(cwd) });
    const port = await listen(app);
    const projectId = idFor(cwd);

    const client = await connect(port, projectId);
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
    const { app, provider } = makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp();
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'set_permission_mode', payload: { mode: 'plan' } });

    const error = await client.nextMatching((event) => event.kind === 'error');
    expect(error).toMatchObject({ payload: { code: 'no_active_turn' } });
    expect(provider.permissionModes).toEqual([]);
  });

  it('round-trips a gated tool: approval_request out, approval_response back', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider } = makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app } = makeApp();
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp({ messages: partialTranscript(cwd), holdRuns: true });
    const port = await listen(app);
    const projectId = idFor(cwd);

    const first = await connect(port, projectId);
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

    const second = await connect(port, projectId);
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
    const { app, provider } = makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
    await client.next(); // the snapshot

    // Unparseable JSON, an unknown type, and a payload missing a required field
    // all land on the same answer.
    const malformed: unknown[] = [
      'this is not json',
      { v: 1, id: 'c1', type: 'no_such_type', payload: {} },
      { v: 1, id: 'c2', type: 'send_prompt', payload: {} },
    ];
    for (const [index, frame] of malformed.entries()) {
      if (typeof frame === 'string') client.sendRaw(frame);
      else client.send(frame);
      const error = await client.nextMatching((event) => event.kind === 'error');
      expect(error, `frame ${index}`).toMatchObject({ payload: { code: 'invalid_message' } });
    }

    // Nothing above closed or wedged the socket.
    client.send({ v: 1, id: 'c3', type: 'send_prompt', payload: { prompt: 'still here' } });
    const started = await client.nextMatching((event) => event.kind === 'stream_status');
    expect(started).toMatchObject({ payload: { status: 'turn_started' } });
    await expect(provider.waitForQueryInput(1)).resolves.toMatchObject({ prompt: 'still here' });
  });

  it('reports an internal error when a run fails before its result, and returns to idle', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app } = makeApp({ messages: partialTranscript(cwd), failRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app } = makeApp({ messages: transcript(cwd), failRuns: true });
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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
    const { app, provider } = makeApp();
    // A provider that fails synchronously is the one path the scripted fake does
    // not model, so it is scripted here — the assertion is still the wire's.
    provider.query = () => {
      throw new Error('cannot start');
    };
    const port = await listen(app);

    const client = await connect(port, idFor(cwd));
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

  /** The id the wire carries for a directory: base64url of its canonical path. */
  async function projectIdFor(directory: string): Promise<string> {
    return idFor(await realpath(directory));
  }

  async function listen(app: FastifyInstance): Promise<number> {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the test server did not bind a port');
    }
    return address.port;
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

function connect(port: number, projectId: string | undefined): Promise<BusClient> {
  const query = projectId === undefined ? '' : `?projectId=${encodeURIComponent(projectId)}`;
  const url = `ws://127.0.0.1:${port}/ws${query}`;
  const socket = new WebSocket(url);

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
