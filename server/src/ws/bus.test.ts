import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type {
  ApprovalRequestPayload,
  PermissionMode,
  ServerEvent,
  SDKMessage,
  SlashCommand,
} from '@clodeck/shared';

import type { AppOptions } from '../app.js';
import { createProjectDiscovery } from '../discovery.js';
import { createProviderProfiles } from '../profiles.js';
import { BYPASS_OFF_BY_PROJECT, BYPASS_OFF_BY_SERVER } from '../bypass.js';
import { BASH_APPROVAL_REASON } from '../sdk/bash-approval.js';
import { PLAN_DENIAL_REASON, plansDirectory } from '../sdk/plan-denial.js';
import {
  createSandbox,
  createTestApp,
  listen,
  login,
  removeSandbox,
  type Sandbox,
} from '../test-support.js';
import { createFakeProvider, type FakeProvider, type FakeProviderOptions } from '../testing/fake-provider.js';
import { createFakePtySpawner } from '../testing/fake-pty.js';

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
      permissionMode: 'default',
      // The suite's app allows Bypass, which is the server's own default: the
      // snapshot states it — and the reason when it does not (ticket 85).
      bypass: { allowed: true },
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
    // The continue target applied once and was consumed; the send that follows
    // continues the session the first turn named, which is now the chat's own.
    expect(second).toMatchObject({ prompt: 'two', resume: SESSION_ID });
    expect(second.continueLatest).toBeUndefined();
  });

  it('continues the session the last turn created, with no target armed', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'one' } });
    await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
    );
    client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'two' } });

    // A chat is one conversation: a follow-up keeps the context the previous
    // turn built instead of starting a fresh session and re-exploring it.
    await expect(provider.waitForQueryInput(2)).resolves.toMatchObject({
      prompt: 'two',
      resume: SESSION_ID,
    });
  });

  it('starts a new chat after clear_resume, even when a turn named a session', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'one' } });
    await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
    );
    client.send({ v: 1, id: 'c2', type: 'clear_resume', payload: {} });
    client.send({ v: 1, id: 'c3', type: 'send_prompt', payload: { prompt: 'fresh' } });

    // The session id went with the transcript, so auto-resume has nothing left
    // to continue either.
    const second = await provider.waitForQueryInput(2);
    expect(second.resume).toBeUndefined();
    expect(second.continueLatest).toBeUndefined();
  });

  it('logs the result’s own token totals, never the Claude-priced estimate', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const lines: string[] = [];
    const { app, cookie } = await makeApp(
      { messages: transcript(cwd) },
      { log: (line) => lines.push(line) },
    );
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hi' } });
    await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
    );

    // `total_cost_usd` is a Claude-list-rate guess on this endpoint; the log
    // records what the SDK actually counted.
    expect(lines.filter((line) => line.startsWith('session tokens'))).toEqual([
      'session tokens · fake-provider in 12 · cache read 0 · cache write 0 · out 1',
    ]);
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

  it('drops the armed target on clear_resume, so the next send is a session of its own', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);

    const client = await connect(port, cookie, idFor(cwd));
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'resume', payload: { sessionId: 'sess-42', fork: true } });
    client.send({ v: 1, id: 'c2', type: 'clear_resume', payload: {} });
    client.send({ v: 1, id: 'c3', type: 'send_prompt', payload: { prompt: 'fresh' } });

    // Until this message existed nothing could cancel an armed target but a send
    // that consumed it (ticket 11's first gap): the send that follows resumes
    // nothing at all.
    const first = await provider.waitForQueryInput(1);
    expect(first).toMatchObject({ prompt: 'fresh' });
    expect(first.resume).toBeUndefined();
    expect(first.forkSession).toBeUndefined();
    expect(first.continueLatest).toBeUndefined();
  });

  it('clears the buffered transcript and the session on clear_resume, for every socket', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
    const port = await listen(app);
    const projectId = idFor(cwd);

    const client = await connect(port, cookie, projectId);
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
    await client.nextMatching(
      (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
    );

    // The buffer a new chat has to clear: a socket joining now is handed the
    // whole turn back.
    const other = await connect(port, cookie, projectId);
    const before = await other.next();
    expect(before).toMatchObject({ kind: 'snapshot', sessionId: SESSION_ID });
    if (before.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${before.kind}`);
    expect(before.payload.blocks).not.toEqual([]);

    client.send({ v: 1, id: 'c2', type: 'clear_resume', payload: {} });

    // The run is the project's, so the clear is answered to *every* socket on
    // it: a second tab is looking at the same chat, and it is now a new one.
    const cleared = await other.next();
    expect(cleared).toMatchObject({ kind: 'snapshot' });
    expect(cleared.sessionId).toBeUndefined();
    if (cleared.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${cleared.kind}`);
    expect(cleared.payload).toEqual({
      state: 'idle',
      permissionMode: 'default',
      bypass: { allowed: true },
      blocks: [],
      pendingApprovals: [],
      lastSeq: 0,
    });

    // Gone, not merely unseen: a socket that connects afterwards rebuilds from
    // the same nothing.
    const reconnected = await connect(port, cookie, projectId);
    const after = await reconnected.next();
    expect(after.sessionId).toBeUndefined();
    if (after.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${after.kind}`);
    expect(after.payload.blocks).toEqual([]);

    // And it created nothing: a new chat writes nothing — no session, no file —
    // until a prompt is sent.
    expect(provider.queryInputs).toHaveLength(1);
  });

  it('follows the SDK’s own conversation reset, with an emptied buffer and the conversation it moved to', async () => {
    await mkdir(path.join(root, 'alpha'));
    const cwd = await realpath(path.join(root, 'alpha'));
    const { app, provider, cookie } = await makeApp({ messages: resetTranscript(cwd) });
    const port = await listen(app);
    const projectId = idFor(cwd);

    const client = await connect(port, cookie, projectId);
    await client.next(); // the snapshot
    client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });

    // Everything the run put on the wire, in order, up to the end of the turn.
    const streamed: ServerEvent[] = [];
    for (;;) {
      const event = await client.next();
      streamed.push(event);
      if (event.kind === 'stream_status' && event.payload.status === 'turn_ended') break;
    }

    // The reset is the SDK's, not the client's: it arrived mid-turn as a frame of
    // its own, under the conversation it announces rather than the one it drops.
    const reset = streamed.find(
      (event) => event.kind === 'sdk' && event.payload.type === 'conversation_reset',
    );
    expect(reset).toMatchObject({ kind: 'sdk', projectId, sessionId: RESET_SESSION_ID });

    // And it emptied the run for everyone, not only for the socket it happened
    // to arrive on: a snapshot with no blocks, naming the new conversation.
    const cleared = streamed.filter((event) => event.kind === 'snapshot');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ kind: 'snapshot', projectId, sessionId: RESET_SESSION_ID });
    if (cleared[0]?.kind !== 'snapshot') throw new Error('expected a snapshot');
    expect(cleared[0].payload).toEqual({
      state: 'running',
      permissionMode: 'default',
      bypass: { allowed: true },
      blocks: [],
      pendingApprovals: [],
      lastSeq: 0,
    });

    // The transcript before it is gone, not merely unseen: a socket joining
    // afterwards rebuilds from what the run kept — the frames that followed the
    // reset — and never from the conversation that was discarded.
    const reconnected = await connect(port, cookie, projectId);
    const after = await reconnected.next();
    expect(after).toMatchObject({ kind: 'snapshot', sessionId: RESET_SESSION_ID });
    if (after.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${after.kind}`);
    expect(after.payload.blocks.map((block) => block.type)).toEqual(['result']);

    expect(provider.queryInputs).toHaveLength(1);
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
    // The thrown message rides along: a run the SDK refused says why, and the
    // banner is where a user reads it (ticket 85's root/sudo case).
    expect(error).toMatchObject({
      payload: { code: 'internal', message: 'the turn failed: scripted failure' },
    });

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

  describe('the commands a run offers', () => {
    /** What a started run reports it can dispatch — built-ins included, which no file declares. */
    const LIST: SlashCommand[] = [
      { name: 'code-review', description: 'Review the diff.', argumentHint: '[low|high]' },
      { name: 'clear', description: 'Start a new session with empty context.', argumentHint: '[name]', builtin: true },
    ];

    it('hands the socket the run’s own list as the turn starts, once', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({ messages: transcript(cwd), commands: LIST });
      const port = await listen(app);
      const projectId = idFor(cwd);

      const client = await connect(port, cookie, projectId);
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });

      // A run that has just started has announced nothing of its own: the SDK
      // pushes a list only when it *changes*. So this is asked for, and it is
      // the only source of a built-in's description.
      const listed = await client.nextMatching((event) => event.kind === 'commands');
      expect(listed).toMatchObject({ projectId, payload: { commands: LIST } });

      // Once for the run, not once per turn of the socket: every later frame of
      // this turn is an SDK message or the turn's end.
      const rest: ServerEvent[] = [];
      for (;;) {
        const event = await client.next();
        rest.push(event);
        if (event.kind === 'stream_status' && event.payload.status === 'turn_ended') break;
      }
      expect(rest.filter((event) => event.kind === 'commands')).toEqual([]);
      expect(provider.queryInputs).toHaveLength(1);
    });

    it('keeps the list for a socket that joins later, and drops it with the transcript', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, cookie } = await makeApp({ messages: transcript(cwd), commands: LIST });
      const port = await listen(app);
      const projectId = idFor(cwd);

      const client = await connect(port, cookie, projectId);
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });
      await client.nextMatching(
        (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
      );

      // The list is not a block, so it rides the snapshot in a field of its own:
      // without it a reconnect would drop the run's commands and the menu would
      // fall back to the project's files alone.
      const other = await connect(port, cookie, projectId);
      const opening = await other.next();
      expect(opening).toMatchObject({ kind: 'snapshot', payload: { commands: LIST } });

      // A new chat is a session of its own, and the list described the old one.
      client.send({ v: 1, id: 'c2', type: 'clear_resume', payload: {} });
      const cleared = await other.next();
      expect(cleared).toMatchObject({ kind: 'snapshot' });
      if (cleared.kind !== 'snapshot') throw new Error(`expected a snapshot, got ${cleared.kind}`);
      expect(cleared.payload).not.toHaveProperty('commands');
    });

    it('leaves the client with what it had when a run cannot list its commands', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, cookie } = await makeApp({
        messages: transcript(cwd),
        commands: LIST,
        commandsFail: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'hello' } });

      // A menu nobody could fill is not the turn's business: the turn runs, the
      // socket hears nothing about commands, and the client keeps the project's
      // own files to offer.
      const seen: ServerEvent[] = [];
      for (;;) {
        const event = await client.next();
        seen.push(event);
        if (event.kind === 'stream_status' && event.payload.status === 'turn_ended') break;
      }
      expect(seen.filter((event) => event.kind === 'commands')).toEqual([]);
      expect(seen.filter((event) => event.kind === 'error')).toEqual([]);
    });
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

  describe('the permission mode a turn runs under', () => {
    /** One send from a socket, with `permissionMode` when the test names one. */
    function send(
      client: BusClient,
      prompt: string,
      permissionMode?: PermissionMode,
    ): void {
      client.send({
        v: 1,
        id: prompt,
        type: 'send_prompt',
        payload: permissionMode === undefined ? { prompt } : { prompt, permissionMode },
      });
    }

    /**
     * Reads frames until `predicate` matches and hands back everything it read.
     * Unlike `nextMatching` this keeps the frames before the match, which is how
     * a test says an event *never* arrived.
     */
    async function readUntil(
      client: BusClient,
      predicate: (event: ServerEvent) => boolean,
    ): Promise<ServerEvent[]> {
      const seen: ServerEvent[] = [];
      for (;;) {
        const event = await client.next();
        seen.push(event);
        if (predicate(event)) return seen;
      }
    }

    it('opens a connection in the deployment’s mode', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      // A deployment whose default is not the SDK's: the snapshot has to carry
      // it, because that is the only way a fresh client can show the mode.
      const { app, cookie } = await makeApp({}, { permissionMode: 'acceptEdits' });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      const snapshot = await client.next();

      expect(snapshot).toMatchObject({ kind: 'snapshot', payload: { permissionMode: 'acceptEdits' } });
    });

    it('passes the send’s own mode to the query, and keeps it for the next turn', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one', 'acceptEdits');
      await provider.waitForQueryInput(1);
      expect(provider.queryInputs[0]?.permissionMode).toBe('acceptEdits');
      await client.nextMatching(
        (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
      );

      // Every turn is a fresh `query()`. Without the run remembering the choice,
      // this send would fall back to the SDK's default — the bug the ticket is
      // about.
      send(client, 'two');
      await provider.waitForQueryInput(2);
      expect(provider.queryInputs[1]?.permissionMode).toBe('acceptEdits');
    });

    it('switches a running turn and starts the next one in the new mode', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one');
      await provider.waitForQueryInput(1);
      // Drain the opening frames so the next `stream_status` is the next turn's.
      await client.nextMatching(
        (event) => event.kind === 'sdk' && event.payload.type === 'assistant',
      );

      client.send({ v: 1, id: 'c2', type: 'set_permission_mode', payload: { mode: 'plan' } });
      await expect(provider.waitForPermissionMode(1)).resolves.toBe('plan');
      provider.releaseRuns();
      // The held run returns on the following microtask; the next frame travels
      // a real socket, so the project is idle before it is dispatched.
      await new Promise((resolve) => setImmediate(resolve));

      send(client, 'two');
      await provider.waitForQueryInput(2);
      expect(provider.queryInputs[1]?.permissionMode).toBe('plan');
    });

    it('restores the run’s mode on a reconnecting socket', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);
      const projectId = idFor(cwd);

      const first = await connect(port, cookie, projectId);
      await first.next(); // the snapshot
      send(first, 'one', 'plan');
      await provider.waitForQueryInput(1);
      first.close();
      await first.waitForClose();

      // The mode is the run's, not the connection's: a new socket reads it back
      // from the snapshot rather than starting in Ask.
      const second = await connect(port, cookie, projectId);
      const snapshot = await second.next();
      expect(snapshot).toMatchObject({ kind: 'snapshot', payload: { permissionMode: 'plan' } });

      provider.releaseRuns();
    });

    it('returns to CLODECK_PERMISSION_MODE on a New chat', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp(
        { messages: transcript(cwd) },
        { permissionMode: 'acceptEdits' },
      );
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one', 'plan');
      await provider.waitForQueryInput(1);
      await client.nextMatching(
        (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
      );

      client.send({ v: 1, id: 'c2', type: 'clear_resume', payload: {} });
      const cleared = await client.nextMatching((event) => event.kind === 'snapshot');
      expect(cleared).toMatchObject({ kind: 'snapshot', payload: { permissionMode: 'acceptEdits' } });

      // The next session is the deployment's, not the one just thrown away.
      send(client, 'fresh');
      await provider.waitForQueryInput(2);
      expect(provider.queryInputs[1]?.permissionMode).toBe('acceptEdits');
    });

    it('keeps each project’s mode with that project’s run', async () => {
      await mkdir(path.join(root, 'alpha'));
      await mkdir(path.join(root, 'beta'));
      const alpha = await realpath(path.join(root, 'alpha'));
      const beta = await realpath(path.join(root, 'beta'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(alpha),
        holdRuns: true,
      });
      const port = await listen(app);

      const first = await connect(port, cookie, idFor(alpha));
      await first.next(); // the snapshot
      send(first, 'one', 'plan');
      await provider.waitForQueryInput(1);

      // Another project is another run: it starts in the deployment's mode, not
      // in the one the first project chose.
      const other = await connect(port, cookie, idFor(beta));
      const betaSnapshot = await other.next();
      expect(betaSnapshot).toMatchObject({ kind: 'snapshot', payload: { permissionMode: 'default' } });

      // Switching back is the run that never left.
      const back = await connect(port, cookie, idFor(alpha));
      const alphaSnapshot = await back.next();
      expect(alphaSnapshot).toMatchObject({ kind: 'snapshot', payload: { permissionMode: 'plan' } });

      provider.releaseRuns();
    });

    it('refuses the modes the contract does not offer, and starts nothing', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp();
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot

      // `auto` and `dontAsk` are refused for good; Bypass is a mode the wire
      // carries and the gates decide, so it is not this test's refusal.
      for (const mode of ['auto', 'dontAsk'] as const) {
        client.send({
          v: 1,
          id: `send-${mode}`,
          type: 'send_prompt',
          payload: { prompt: 'hello', permissionMode: mode },
        });
        const invalidSend = await client.nextMatching((event) => event.kind === 'error');
        expect(invalidSend).toMatchObject({ payload: { code: 'invalid_message' } });

        client.send({ v: 1, id: `set-${mode}`, type: 'set_permission_mode', payload: { mode } });
        const invalidSet = await client.nextMatching((event) => event.kind === 'error');
        expect(invalidSet).toMatchObject({ payload: { code: 'invalid_message' } });
      }

      expect(provider.queryInputs).toEqual([]);
      expect(provider.permissionModes).toEqual([]);
    });

    it('answers a parked approval under the mode it was raised in', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one');
      await provider.waitForQueryInput(1);

      // The tool gate is already waiting when the mode moves: the question was
      // asked under Ask, so its answer is the one Ask expects — the switch is
      // for what comes next, not a re-read of what the user is looking at.
      const answer = provider.requestApproval(APPROVAL_REQUEST);
      await client.nextMatching((event) => event.kind === 'approval_request');
      client.send({ v: 1, id: 'c2', type: 'set_permission_mode', payload: { mode: 'plan' } });
      await expect(provider.waitForPermissionMode(1)).resolves.toBe('plan');

      client.send({
        v: 1,
        id: 'c3',
        type: 'approval_response',
        payload: { requestId: APPROVAL_REQUEST.requestId, behavior: 'allow' },
      });
      await expect(answer).resolves.toMatchObject({
        requestId: APPROVAL_REQUEST.requestId,
        behavior: 'allow',
      });

      provider.releaseRuns();
    });

    it('applies a mid-turn switch to the calls after it: Ask → Bypass', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one');
      await provider.waitForQueryInput(1);
      expect(provider.queryInputs[0]?.permissionMode).toBe('default');

      // In Ask the call parks, as the mode promises.
      const before = provider.requestToolUse('Bash', { command: 'ls' });
      const parked = await client.nextMatching((event) => event.kind === 'approval_request');
      if (parked.kind !== 'approval_request') {
        throw new Error(`expected an approval_request, got ${parked.kind}`);
      }
      client.send({
        v: 1,
        id: 'c2',
        type: 'approval_response',
        payload: { requestId: parked.payload.requestId, behavior: 'allow' },
      });
      await expect(before).resolves.toMatchObject({ asked: true, result: { behavior: 'allow' } });

      // The switch lands mid-turn, and the gate the run was built with has to
      // read it for the *next* call — not only for the next `query()` (ticket
      // 92). Under the old closures this call still parked in the modal.
      client.send({
        v: 1,
        id: 'c3',
        type: 'set_permission_mode',
        payload: { mode: 'bypassPermissions' },
      });
      await expect(provider.waitForPermissionMode(1)).resolves.toBe('bypassPermissions');

      await expect(
        provider.requestToolUse('Bash', { command: 'rm -rf build' }),
      ).resolves.toMatchObject({ asked: false, result: { behavior: 'allow' } });

      provider.releaseRuns();
    });

    it('applies a mid-turn switch to the calls after it: Bypass → Ask', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await expect(client.next()).resolves.toMatchObject({
        kind: 'snapshot',
        payload: { bypass: { allowed: true } },
      });
      send(client, 'one', 'bypassPermissions');
      await provider.waitForQueryInput(1);

      // Bypass: the call runs without a modal.
      await expect(provider.requestToolUse('Bash', { command: 'ls' })).resolves.toMatchObject({
        asked: false,
        result: { behavior: 'allow' },
      });

      // Back in Ask mid-turn, the very next call must park — the gate cannot
      // have been left out of the run at `query()` time (ticket 92).
      client.send({ v: 1, id: 'c2', type: 'set_permission_mode', payload: { mode: 'default' } });
      await expect(provider.waitForPermissionMode(1)).resolves.toBe('default');

      const after = provider.requestToolUse('Bash', { command: 'ls' });
      const parked = await client.nextMatching((event) => event.kind === 'approval_request');
      if (parked.kind !== 'approval_request') {
        throw new Error(`expected an approval_request, got ${parked.kind}`);
      }
      expect(parked.payload).toMatchObject({
        toolName: 'Bash',
        decisionReason: BASH_APPROVAL_REASON,
      });

      client.send({
        v: 1,
        id: 'c3',
        type: 'approval_response',
        payload: { requestId: parked.payload.requestId, behavior: 'allow' },
      });
      await expect(after).resolves.toMatchObject({ asked: true, result: { behavior: 'allow' } });

      provider.releaseRuns();
    });

    it('parks a Bash call in Ask, and runs it on allow', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'tidy up');
      await provider.waitForQueryInput(1);
      expect(provider.queryInputs[0]?.permissionMode).toBe('default');

      // The run's own PreToolUse gate decides "ask", so a read-only command is
      // parked like any other until the user answers.
      const tool = provider.requestToolUse('Bash', { command: 'ls' });
      const request = await client.nextMatching((event) => event.kind === 'approval_request');
      if (request.kind !== 'approval_request') {
        throw new Error(`expected an approval_request, got ${request.kind}`);
      }
      expect(request.payload).toMatchObject({
        toolName: 'Bash',
        input: { command: 'ls' },
        decisionReason: BASH_APPROVAL_REASON,
      });

      client.send({
        v: 1,
        id: 'c2',
        type: 'approval_response',
        payload: { requestId: request.payload.requestId, behavior: 'allow' },
      });

      // `allow` is the tool running: the gate's promise settles with it.
      await expect(tool).resolves.toMatchObject({ asked: true, result: { behavior: 'allow' } });
      provider.releaseRuns();
    });

    it('parks Bash in Accept edits while file tools run unprompted', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one', 'acceptEdits');
      await provider.waitForQueryInput(1);

      // Accept edits pre-approves the file tools, so only Bash reaches the gate.
      await expect(
        provider.requestToolUse('Write', { file_path: 'a.ts', content: 'x' }),
      ).resolves.toMatchObject({ asked: false, result: { behavior: 'allow' } });
      await expect(provider.requestToolUse('Read', { file_path: 'a.ts' })).resolves.toMatchObject({
        asked: false,
        result: { behavior: 'allow' },
      });

      const tool = provider.requestToolUse('Bash', { command: 'mkdir build' });
      const request = await client.nextMatching((event) => event.kind === 'approval_request');
      if (request.kind !== 'approval_request') {
        throw new Error(`expected an approval_request, got ${request.kind}`);
      }

      client.send({
        v: 1,
        id: 'c2',
        type: 'approval_response',
        payload: { requestId: request.payload.requestId, behavior: 'allow' },
      });

      await expect(tool).resolves.toMatchObject({ asked: true, result: { behavior: 'allow' } });
      provider.releaseRuns();
    });

    it('denies Plan’s tools without an approval request, and the turn carries on', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: transcript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'plan it', 'plan');
      await provider.waitForQueryInput(1);
      expect(provider.queryInputs[0]?.permissionMode).toBe('plan');

      // The PreToolUse gate denies straight away: nothing is parked, and the
      // model gets the reason instead of a modal. `ls` is denied like `rm` —
      // Plan does not run commands at all.
      for (const [toolName, input] of [
        ['Write', { file_path: 'a.ts', content: 'x' }],
        ['Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }],
        ['Bash', { command: 'ls' }],
        ['ExitPlanMode', {}],
      ] as const) {
        await expect(provider.requestToolUse(toolName, input)).resolves.toMatchObject({
          asked: false,
          result: { behavior: 'deny', message: PLAN_DENIAL_REASON },
        });
      }

      // Reads are free in Plan: the gate neither asks nor denies them.
      for (const toolName of ['Read', 'Glob', 'Grep']) {
        await expect(provider.requestToolUse(toolName, {})).resolves.toMatchObject({
          asked: false,
          result: { behavior: 'allow' },
        });
      }

      // The denials did not take the turn down: it reaches its scripted success
      // result, and no approval request was ever emitted.
      provider.releaseRuns();
      const frames = await readUntil(
        client,
        (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
      );
      expect(frames.some((event) => event.kind === 'approval_request')).toBe(false);
      expect(
        frames.some(
          (event) =>
            event.kind === 'sdk' && event.payload.type === 'result' && event.payload.subtype === 'success',
        ),
      ).toBe(true);
    });

    it('keeps Plan’s clarifying question on the modal', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'plan it', 'plan');
      await provider.waitForQueryInput(1);

      // `AskUserQuestion` is the one tool Plan deliberately sends on: a plan
      // needs the answer, so it still parks in the approval modal.
      const tool = provider.requestToolUse('AskUserQuestion', { questions: [] });
      const request = await client.nextMatching((event) => event.kind === 'approval_request');
      if (request.kind !== 'approval_request') {
        throw new Error(`expected an approval_request, got ${request.kind}`);
      }
      expect(request.payload).toMatchObject({ toolName: 'AskUserQuestion' });
      // It is a question, not a denial, so no gate reason is attached.
      expect(request.payload).not.toHaveProperty('decisionReason');

      client.send({
        v: 1,
        id: 'c2',
        type: 'approval_response',
        payload: { requestId: request.payload.requestId, behavior: 'allow' },
      });

      await expect(tool).resolves.toMatchObject({ asked: true, result: { behavior: 'allow' } });
      provider.releaseRuns();
    });

    it('lets the SDK write its own plan file, and leaves Plan only through the mode', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'plan it', 'plan');
      await provider.waitForQueryInput(1);

      // The plan the model is composing is written under the SDK's own plans
      // directory; Plan must not deny its own record.
      await expect(
        provider.requestToolUse('Write', {
          file_path: path.join(plansDirectory(), 'plan.md'),
          content: '# the plan',
        }),
      ).resolves.toMatchObject({ asked: false, result: { behavior: 'allow' } });

      // Denying ExitPlanMode leaves the session where it was.
      await expect(provider.requestToolUse('ExitPlanMode', {})).resolves.toMatchObject({
        asked: false,
        result: { behavior: 'deny' },
      });
      const stillPlan = await connect(port, cookie, idFor(cwd));
      await expect(stillPlan.next()).resolves.toMatchObject({
        kind: 'snapshot',
        payload: { permissionMode: 'plan' },
      });

      // The chip is the way out: a live switch moves the run's stored mode, and
      // a reconnect reads it back.
      client.send({ v: 1, id: 'c2', type: 'set_permission_mode', payload: { mode: 'acceptEdits' } });
      await expect(provider.waitForPermissionMode(1)).resolves.toBe('acceptEdits');

      const afterChip = await connect(port, cookie, idFor(cwd));
      await expect(afterChip.next()).resolves.toMatchObject({
        kind: 'snapshot',
        payload: { permissionMode: 'acceptEdits' },
      });

      provider.releaseRuns();
    });
  });

  /**
   * Bypass and its gates (ticket 85): the deployment's `CLODECK_ALLOW_BYPASS`,
   * the project's own `.claude/settings.json`, and the run's Bypass flag. The
   * two refusals are the server's, not the chip's — a client that ignored the
   * snapshot is refused too, with the same sentence.
   */
  describe('Bypass and its gates', () => {
    /** A project directory, with a settings file when the test needs one. */
    async function projectWith(name: string, settings?: unknown): Promise<string> {
      const dir = path.join(root, name);
      await mkdir(path.join(dir, '.claude'), { recursive: true });
      if (settings !== undefined) {
        await writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
      }
      return realpath(dir);
    }

    function send(client: BusClient, prompt: string, permissionMode?: PermissionMode): void {
      client.send({
        v: 1,
        id: prompt,
        type: 'send_prompt',
        payload: permissionMode === undefined ? { prompt } : { prompt, permissionMode },
      });
    }

    it('opens the snapshot with Bypass allowed, and the reason when it is not', async () => {
      const cwd = await projectWith('alpha');
      const { app, cookie } = await makeApp({}, { allowBypass: false });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      // The chip reads this before it offers anything: a gate the surface cannot
      // see is a gate it cannot explain.
      await expect(client.next()).resolves.toMatchObject({
        kind: 'snapshot',
        payload: { bypass: { allowed: false, reason: BYPASS_OFF_BY_SERVER } },
      });
    });

    it('runs the query with the Bypass flag, and a plain Bash unasked', async () => {
      const cwd = await projectWith('alpha');
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await expect(client.next()).resolves.toMatchObject({
        kind: 'snapshot',
        payload: { bypass: { allowed: true } },
      });

      send(client, 'tidy up', 'bypassPermissions');
      await provider.waitForQueryInput(1);
      expect(provider.queryInputs[0]?.permissionMode).toBe('bypassPermissions');
      // The capability is set at `query()` time, because a mid-turn switch has
      // to be possible and the SDK reads the flag once (decision 10).
      expect(provider.queryInputs[0]?.allowBypass).toBe(true);

      // With no hook in front of it, an ordinary command is not parked.
      await expect(provider.requestToolUse('Bash', { command: 'ls' })).resolves.toMatchObject({
        asked: false,
        result: { behavior: 'allow' },
      });

      provider.releaseRuns();
    });

    it('switches a running turn into Bypass, and the next turn stays there', async () => {
      const cwd = await projectWith('alpha');
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot
      send(client, 'one');
      await provider.waitForQueryInput(1);
      expect(provider.queryInputs[0]?.permissionMode).toBe('default');
      await client.nextMatching(
        (event) => event.kind === 'sdk' && event.payload.type === 'assistant',
      );

      client.send({
        v: 1,
        id: 'c2',
        type: 'set_permission_mode',
        payload: { mode: 'bypassPermissions' },
      });
      await expect(provider.waitForPermissionMode(1)).resolves.toBe('bypassPermissions');
      provider.releaseRuns();
      await new Promise((resolve) => setImmediate(resolve));

      // The run carried the capability from the start, so the turn after the
      // switch runs in Bypass without asking for anything again.
      send(client, 'two');
      await provider.waitForQueryInput(2);
      expect(provider.queryInputs[1]?.permissionMode).toBe('bypassPermissions');
      expect(provider.queryInputs[1]?.allowBypass).toBe(true);
    });

    it('refuses Bypass when the deployment switched it off, and starts nothing', async () => {
      const cwd = await projectWith('alpha');
      const { app, provider, cookie } = await makeApp({ holdRuns: true }, { allowBypass: false });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await client.next(); // the snapshot

      send(client, 'tidy up', 'bypassPermissions');
      const refused = await client.nextMatching((event) => event.kind === 'error');
      expect(refused).toMatchObject({
        payload: { code: 'bypass_unavailable', message: BYPASS_OFF_BY_SERVER },
      });

      // A refused send is not a turn: nothing reached the provider.
      expect(provider.queryInputs).toEqual([]);

      // And a running turn cannot be talked into it either.
      send(client, 'one');
      await provider.waitForQueryInput(1);
      client.send({
        v: 1,
        id: 'c2',
        type: 'set_permission_mode',
        payload: { mode: 'bypassPermissions' },
      });
      const switchRefused = await client.nextMatching((event) => event.kind === 'error');
      expect(switchRefused).toMatchObject({ payload: { code: 'bypass_unavailable' } });
      expect(provider.permissionModes).toEqual([]);

      provider.releaseRuns();
    });

    it('refuses Bypass for a project whose settings disable it, and says why', async () => {
      const cwd = await projectWith('alpha', {
        permissions: { disableBypassPermissionsMode: 'disable' },
      });
      const { app, provider, cookie } = await makeApp({
        messages: partialTranscript(cwd),
        holdRuns: true,
      });
      const port = await listen(app);

      const client = await connect(port, cookie, idFor(cwd));
      await expect(client.next()).resolves.toMatchObject({
        kind: 'snapshot',
        payload: { bypass: { allowed: false, reason: BYPASS_OFF_BY_PROJECT } },
      });

      send(client, 'tidy up', 'bypassPermissions');
      const refused = await client.nextMatching((event) => event.kind === 'error');
      expect(refused).toMatchObject({
        payload: { code: 'bypass_unavailable', message: BYPASS_OFF_BY_PROJECT },
      });
      expect(provider.queryInputs).toEqual([]);

      provider.releaseRuns();
    });
  });

  /**
   * A delete is root-level state (ticket 89), but two things the directory does
   * not own can refuse it. Both live in this process's managers, so they are
   * pinned here through the real socket and the real route (decision 87, D3 and
   * D9).
   */
  describe('deleting a project alongside live state', () => {
    async function deleteProject(
      app: FastifyInstance,
      cookie: string,
      id: string,
    ): Promise<LightMyRequestResponse> {
      return app.inject({
        method: 'DELETE',
        url: `/api/projects/${encodeURIComponent(id)}`,
        headers: { cookie },
      });
    }

    it('answers 409 turn_in_progress for a run that has started but named no session', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      // No messages: the run starts but the SDK names no session, which is
      // exactly the window `runningSession` cannot see and the delete must.
      const { app, provider, cookie } = await makeApp({ holdRuns: true });
      const port = await listen(app);
      const id = idFor(cwd);

      const client = await connect(port, cookie, id);
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'go' } });
      await provider.waitForQueryInput(1);

      try {
        const response = await deleteProject(app, cookie, id);

        expect(response.statusCode).toBe(409);
        expect((response.json() as { error: string }).error).toBe('turn_in_progress');
        // Nothing was removed: the run's working tree is still there.
        await expect(lstat(cwd)).resolves.toBeDefined();
      } finally {
        provider.releaseRuns();
        client.close();
      }
    });

    it('answers 409 terminal_attached while a shell is open, and leaves the directory', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const spawner = createFakePtySpawner();
      const { app, cookie } = await makeApp({}, { spawner });
      const port = await listen(app);
      const id = idFor(cwd);

      const terminal = await openTerminal(port, cookie, id);
      await spawner.waitForSpawn(1);

      try {
        const response = await deleteProject(app, cookie, id);

        expect(response.statusCode).toBe(409);
        expect((response.json() as { error: string }).error).toBe('terminal_attached');
        await expect(lstat(cwd)).resolves.toBeDefined();
      } finally {
        terminal.close();
      }
    });

    it('forgets the run after a delete, so a re-created project starts a fresh chat', async () => {
      await mkdir(path.join(root, 'alpha'));
      const cwd = await realpath(path.join(root, 'alpha'));
      const { app, provider, cookie } = await makeApp({ messages: transcript(cwd) });
      const port = await listen(app);
      const id = idFor(cwd);

      const client = await connect(port, cookie, id);
      await client.next(); // the snapshot
      client.send({ v: 1, id: 'c1', type: 'send_prompt', payload: { prompt: 'one' } });
      await client.nextMatching(
        (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
      );
      // The entry the delete has to forget does hold a session: a second send
      // resumes it, which is the behavior a re-created project must not inherit.
      client.send({ v: 1, id: 'c2', type: 'send_prompt', payload: { prompt: 'two' } });
      await expect(provider.waitForQueryInput(2)).resolves.toMatchObject({ resume: SESSION_ID });
      await client.nextMatching(
        (event) => event.kind === 'stream_status' && event.payload.status === 'turn_ended',
      );
      client.close();

      expect((await deleteProject(app, cookie, id)).statusCode).toBe(204);
      await expect(lstat(cwd)).rejects.toMatchObject({ code: 'ENOENT' });

      // Same directory, same canonical path, therefore the same id — the row
      // the user just created must not secretly be the old chat (D9).
      await mkdir(cwd);
      const recreated = await connect(port, cookie, id);
      await recreated.next(); // the fresh snapshot
      recreated.send({ v: 1, id: 'c3', type: 'send_prompt', payload: { prompt: 'three' } });

      const fresh = await provider.waitForQueryInput(3);
      expect(fresh.resume).toBeUndefined();
      expect(fresh.continueLatest).toBeUndefined();
      recreated.close();
    });
  });
});

/** One scripted turn's messages, replayed by the fake provider on every `query()`. */
const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';

/** The conversation the SDK moves a reset run to — the frame's `new_conversation_id`. */
const RESET_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';

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
      modelUsage: {
        'fake-provider': {
          inputTokens: 12,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
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
 * A turn the SDK discards a conversation during — a `/clear` typed into a running
 * session. The frames after the reset carry the *new* session: that frame is the
 * moment the SDK's own current conversation changed, and the run reads identity
 * from the frames the SDK sends (ticket 76).
 */
function resetTranscript(cwd: string): SDKMessage[] {
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
      type: 'assistant',
      session_id: SESSION_ID,
      parent_tool_use_id: null,
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'before the clear' }] },
    },
    {
      type: 'conversation_reset',
      new_conversation_id: RESET_SESSION_ID,
      uuid: RESET_SESSION_ID,
      session_id: SESSION_ID,
      trigger: 'clear',
    },
    {
      type: 'result',
      subtype: 'success',
      session_id: RESET_SESSION_ID,
      is_error: false,
      result: 'cleared',
      num_turns: 1,
      stop_reason: 'end_turn',
      modelUsage: {},
      total_cost_usd: 0,
      duration_ms: 1,
    },
  ];
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

/**
 * A raw `/ws/terminal` socket, opened only so the terminal manager has a live
 * shell for a project. Bytes are not the subject here; the delete is.
 */
function openTerminal(port: number, cookie: string, projectId: string): Promise<WebSocket> {
  const url = `ws://127.0.0.1:${String(port)}/ws/terminal?projectId=${encodeURIComponent(projectId)}`;
  const socket = new WebSocket(url, { headers: { cookie } });

  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve(socket);
    });
    socket.once('error', reject);
  });
}
