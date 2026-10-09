import {
  PROTOCOL_VERSION,
  type ApprovalRequestPayload,
  type SDKMessage,
  type ServerEvent,
} from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import {
  applyServerEvent,
  dismissApproval,
  emptyView,
  withUserPrompt,
  type ChatView,
} from './reducer';

/**
 * The reducer is the seam: every expected value below comes from the renderer
 * mapping in research 01 §3 and the bus's own event shapes (server/src/ws), not
 * from re-running the implementation.
 */

const SESSION = '00000000-0000-4000-8000-000000000000';

let seq = 0;

function sdk(payload: SDKMessage): ServerEvent {
  seq += 1;
  return { v: PROTOCOL_VERSION, seq, ts: '2026-01-01T00:00:00.000Z', kind: 'sdk', payload };
}

function snapshot(
  blocks: readonly SDKMessage[],
  state: 'idle' | 'running' | 'requires_action',
  pendingApprovals: readonly ApprovalRequestPayload[] = [],
): ServerEvent {
  seq += 1;
  return {
    v: PROTOCOL_VERSION,
    seq,
    ts: '2026-01-01T00:00:00.000Z',
    kind: 'snapshot',
    payload: { state, blocks, pendingApprovals, lastSeq: 0 },
  };
}

function apply(view: ChatView, ...events: readonly ServerEvent[]): ChatView {
  return events.reduce(applyServerEvent, view);
}

const init: SDKMessage = {
  type: 'system',
  subtype: 'init',
  session_id: SESSION,
  cwd: '/projects/demo',
  model: 'claude-sonnet-5-5',
  permissionMode: 'default',
  tools: ['Read', 'Bash'],
};

function assistantText(text: string, parentToolUseId: string | null = null): SDKMessage {
  return {
    type: 'assistant',
    session_id: SESSION,
    parent_tool_use_id: parentToolUseId,
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function toolUse(id: string, name: string, input: unknown, parentToolUseId: string | null = null): SDKMessage {
  return {
    type: 'assistant',
    session_id: SESSION,
    parent_tool_use_id: parentToolUseId,
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  };
}

describe('chat reducer — streaming', () => {
  it('accumulates text_delta into the live buffer without committing it', () => {
    const view = apply(
      emptyView(),
      sdk({
        type: 'stream_event',
        session_id: SESSION,
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      }),
      sdk({
        type: 'stream_event',
        session_id: SESSION,
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      }),
    );

    expect(view.streamingText).toBe('Hello');
    expect(view.entries).toHaveLength(0);
  });

  it('reconciles the complete assistant block against the live deltas, never doubling', () => {
    const view = apply(
      emptyView(),
      sdk({
        type: 'stream_event',
        session_id: SESSION,
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      }),
      sdk(assistantText('Hello')),
    );

    expect(view.streamingText).toBe('');
    expect(view.entries).toEqual([{ kind: 'assistant', text: 'Hello' }]);
  });

  it('renders an assistant tool_use as a card carrying its input', () => {
    const view = apply(emptyView(), sdk(toolUse('tu_1', 'Bash', { command: 'ls -la' })));

    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      kind: 'tool',
      toolUseId: 'tu_1',
      name: 'Bash',
      input: { command: 'ls -la' },
      result: null,
    });
  });

  it('renders an assistant thinking block as a collapsible entry', () => {
    const view = apply(
      emptyView(),
      sdk({
        type: 'assistant',
        session_id: SESSION,
        parent_tool_use_id: null,
        message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'pondering' }] },
      }),
    );

    expect(view.entries).toEqual([{ kind: 'thinking', text: 'pondering' }]);
  });

  it('collapses a user tool result under the tool card that owns it', () => {
    const view = apply(
      emptyView(),
      sdk(toolUse('tu_1', 'Bash', { command: 'ls' })),
      sdk({
        type: 'user',
        session_id: SESSION,
        parent_tool_use_id: null,
        isSynthetic: true,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file-a\nfile-b' }],
        },
      }),
    );

    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      kind: 'tool',
      result: { content: 'file-a\nfile-b', isError: false },
    });
  });

  it('drives the live "Using …" indicator from tool_progress', () => {
    const view = apply(
      emptyView(),
      sdk({
        type: 'tool_progress',
        session_id: SESSION,
        parent_tool_use_id: null,
        tool_use_id: 'tu_1',
        tool_name: 'Bash',
        elapsed_time_seconds: 3,
      }),
    );

    expect(view.progress).toEqual({ toolName: 'Bash', elapsedSeconds: 3 });
  });

  it("records the result's final text and cost as the turn-complete signal", () => {
    const view = apply(
      emptyView(),
      sdk({
        type: 'result',
        subtype: 'success',
        session_id: SESSION,
        is_error: false,
        result: 'All done.',
        num_turns: 2,
        stop_reason: 'end_turn',
        total_cost_usd: 0.0123,
        duration_ms: 4200,
      }),
    );

    expect(view.lastResult).toEqual({
      subtype: 'success',
      text: 'All done.',
      costUsd: 0.0123,
      stopReason: 'end_turn',
      numTurns: 2,
      isError: false,
      errors: [],
    });
  });
});

describe('chat reducer — nesting and unknowns', () => {
  it('nests a frame with a parent_tool_use_id under its parent tool card', () => {
    const view = apply(
      emptyView(),
      sdk(toolUse('task_1', 'Task', { description: 'explore' })),
      sdk(assistantText('inside the subagent', 'task_1')),
      sdk(toolUse('tu_inner', 'Grep', { pattern: 'x' }, 'task_1')),
    );

    expect(view.entries).toHaveLength(1);
    const card = view.entries[0];
    expect(card).toMatchObject({ kind: 'tool', toolUseId: 'task_1' });
    if (card?.kind !== 'tool') throw new Error('expected a tool card');
    expect(card.children).toEqual([
      { kind: 'assistant', text: 'inside the subagent' },
      expect.objectContaining({ kind: 'tool', toolUseId: 'tu_inner' }),
    ]);
  });

  it('ignores an unknown content-block type and an unknown system subtype', () => {
    const view = apply(
      emptyView(),
      sdk({
        type: 'assistant',
        session_id: SESSION,
        parent_tool_use_id: null,
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'server_tool_use' }],
        },
      }),
    );
    // A block the client cannot render is dropped, not crashed on.
    expect(view.entries).toHaveLength(0);

    const afterSystem: ChatView = apply(
      emptyView(),
      sdk({ type: 'system', subtype: 'compact_boundary', session_id: SESSION }),
    );
    expect(afterSystem.entries).toHaveLength(0);
    expect(afterSystem.state).toBe('idle');
  });
});

describe('chat reducer — snapshot, approvals, errors', () => {
  const approval: ApprovalRequestPayload = {
    requestId: 'req_1',
    toolUseID: 'tu_1',
    toolName: 'Bash',
    input: { command: 'rm -rf build' },
    title: 'Claude wants to run a command',
    displayName: 'Run command',
    description: 'rm -rf build',
  };

  it('rebuilds entries, state, session and pending approvals from a snapshot', () => {
    const view = apply(
      emptyView(),
      snapshot(
        [
          init,
          assistantText('Hello from the fake provider.'),
          toolUse('tu_1', 'Bash', { command: 'ls' }),
          {
            type: 'result',
            subtype: 'success',
            session_id: SESSION,
            is_error: false,
            result: 'done',
            num_turns: 1,
            stop_reason: 'end_turn',
            total_cost_usd: 0.02,
            duration_ms: 10,
          },
        ],
        'requires_action',
        [approval],
      ),
    );

    expect(view.sessionId).toBe(SESSION);
    expect(view.cwd).toBe('/projects/demo');
    expect(view.model).toBe('claude-sonnet-5-5');
    expect(view.state).toBe('requires_action');
    expect(view.pendingApprovals).toEqual([approval]);
    expect(view.lastResult?.costUsd).toBe(0.02);
    expect(view.entries).toEqual([
      { kind: 'assistant', text: 'Hello from the fake provider.' },
      expect.objectContaining({ kind: 'tool', name: 'Bash' }),
    ]);
  });

  it('parks an approval_request and drops it once answered', () => {
    const parked = applyServerEvent(emptyView(), {
      v: PROTOCOL_VERSION,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'approval_request',
      payload: approval,
    });

    expect(parked.pendingApprovals).toEqual([approval]);
    expect(dismissApproval(parked, 'req_1').pendingApprovals).toEqual([]);
  });

  it('surfaces a turn_in_progress error rather than driving the model again', () => {
    const view = applyServerEvent(emptyView(), {
      v: PROTOCOL_VERSION,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'error',
      payload: { code: 'turn_in_progress', message: 'a turn is already running' },
    });

    expect(view.lastError).toEqual({ code: 'turn_in_progress', message: 'a turn is already running' });
  });

  it('marks an interrupted turn idle and notes it in the transcript', () => {
    let view: ChatView = { ...emptyView(), state: 'running' };
    view = applyServerEvent(view, {
      v: PROTOCOL_VERSION,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'stream_status',
      payload: { status: 'interrupted' },
    });

    expect(view.state).toBe('idle');
    expect(view.entries).toEqual([{ kind: 'notice', text: 'Interrupted' }]);
  });

  it('shows the prompt immediately and does not double it when the bus echoes it', () => {
    const optimisitic = withUserPrompt(emptyView(), 'hello');
    expect(optimisitic.entries).toEqual([{ kind: 'user', text: 'hello' }]);

    const echoed = applyServerEvent(
      optimisitic,
      sdk({
        type: 'user',
        session_id: SESSION,
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hello' },
      }),
    );

    expect(echoed.entries).toEqual([{ kind: 'user', text: 'hello' }]);
  });
});
