import type { ApprovalRequestPayload, SDKMessage, SessionMessage, SessionSummary } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { createFakeProvider } from './fake-provider.js';

/**
 * The fake is the seam the bus, the REST routes and every later test drive the
 * server through, so its *control surface* is the thing under test here: what it
 * records, what a test can wait on, and whether it can hand a pending approval
 * back to the test that wants to answer it. Its `query()`-shaped behavior is
 * covered where it is consumed (ticket 08's bus, ticket 09's routes).
 */

/** A minimal mirrored message: the fake is handed the mirror, not the real SDK union. */
function assistant(text: string): SDKMessage {
  return {
    type: 'assistant',
    session_id: 's1',
    parent_tool_use_id: null,
    message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text }] },
  };
}

async function collect(iterable: AsyncIterable<SDKMessage>): Promise<SDKMessage[]> {
  const collected: SDKMessage[] = [];
  for await (const message of iterable) {
    collected.push(message);
  }
  return collected;
}

const REQUEST: ApprovalRequestPayload = {
  requestId: 'r1',
  toolUseID: 't1',
  toolName: 'Bash',
  input: { command: 'ls' },
};

describe('the scripted fake provider', () => {
  it('streams the scripted queue as the run’s messages, in order', async () => {
    const provider = createFakeProvider({ messages: [assistant('one'), assistant('two')] });

    const run = provider.query({ cwd: '/projects/a', prompt: 'hi' });

    expect(await collect(run.messages)).toEqual([assistant('one'), assistant('two')]);
  });

  it('records every query() input in call order', () => {
    const provider = createFakeProvider();

    provider.query({ cwd: '/projects/a', prompt: 'first' });
    provider.query({ cwd: '/projects/b', prompt: 'second', resume: 's9', forkSession: true });
    provider.query({ cwd: '/projects/c', prompt: 'third', continueLatest: true });

    expect(provider.queryInputs.map((input) => input.cwd)).toEqual([
      '/projects/a',
      '/projects/b',
      '/projects/c',
    ]);
    expect(provider.queryInputs[1]).toMatchObject({ resume: 's9', forkSession: true });
    expect(provider.queryInputs[2]?.continueLatest).toBe(true);
  });

  it('parks a waiter until a query() the test has not made yet arrives', async () => {
    const provider = createFakeProvider();

    const pending = provider.waitForQueryInput(1);
    provider.query({ cwd: '/projects/a', prompt: 'later' });

    expect((await pending).prompt).toBe('later');
  });

  it('records interrupt() and setPermissionMode(), and lets a test wait on either', async () => {
    const provider = createFakeProvider();
    const run = provider.query({ cwd: '/projects/a', prompt: 'hi' });

    await run.interrupt();
    await run.setPermissionMode('plan');

    expect(provider.interruptCount).toBe(1);
    expect(provider.permissionModes).toEqual(['plan']);
    await expect(provider.waitForInterrupt(1)).resolves.toBeUndefined();
    await expect(provider.waitForPermissionMode(1)).resolves.toBe('plan');
  });

  it('drives an approval through the canUseTool the run was handed', async () => {
    const provider = createFakeProvider();
    provider.query({
      cwd: '/projects/a',
      prompt: 'hi',
      canUseTool: (request) => Promise.resolve({ requestId: request.requestId, behavior: 'allow' }),
    });

    await expect(provider.requestApproval(REQUEST)).resolves.toEqual({ requestId: 'r1', behavior: 'allow' });
  });

  it('rejects a drive when the run has no approval callback to hand it to', async () => {
    const provider = createFakeProvider();
    provider.query({ cwd: '/projects/a', prompt: 'hi' });

    await expect(provider.requestApproval(REQUEST)).rejects.toThrow(/canUseTool/);
  });

  it('returns the canned session history the test supplied', async () => {
    const sessions: SessionSummary[] = [{ id: 's1', title: 'first chat' }];
    const messages: SessionMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const provider = createFakeProvider({ sessions, sessionMessages: messages });

    await expect(provider.listSessions('/projects/a')).resolves.toEqual(sessions);
    await expect(provider.getSessionMessages('s1', '/projects/a')).resolves.toEqual(messages);
  });
});
