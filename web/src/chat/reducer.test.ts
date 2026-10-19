import {
  PROTOCOL_VERSION,
  type ApprovalRequestPayload,
  type SDKMessage,
  type SDKSystemInitMessage,
  type ServerEvent,
  type SessionMessage,
  type SlashCommand,
} from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import {
  applyServerEvent,
  dismissApproval,
  emptyView,
  fromSessionMessages,
  withResumeTarget,
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

/** The same event as the server stamps it: the run's session on the envelope. */
function stamped(event: ServerEvent, sessionId: string): ServerEvent {
  return { ...event, sessionId };
}

/** The bus's own signal that a turn began — no block, so no session in the payload. */
const turnStarted: ServerEvent = {
  v: PROTOCOL_VERSION,
  seq: 1,
  ts: '2026-01-01T00:00:00.000Z',
  kind: 'stream_status',
  payload: { status: 'turn_started' },
};

const init: SDKSystemInitMessage = {
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

  it("records the result's final text and token usage as the turn-complete signal", () => {
    const modelUsage = {
      'deepseek-flash[1m]': {
        inputTokens: 418,
        outputTokens: 37,
        cacheReadInputTokens: 12_000,
        cacheCreationInputTokens: 0,
      },
    };
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
        modelUsage,
        // The Claude-priced estimate is on the wire but deliberately not carried
        // into the view: it is not a bill on this endpoint.
        total_cost_usd: 0.0123,
        duration_ms: 4200,
      }),
    );

    expect(view.lastResult).toEqual({
      subtype: 'success',
      text: 'All done.',
      modelUsage,
      stopReason: 'end_turn',
      numTurns: 2,
      isError: false,
      errors: [],
      canResume: false,
    });
  });
});

describe('chat reducer — resuming a capped turn', () => {
  function errorResult(
    subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries',
  ): SDKMessage {
    return {
      type: 'result',
      subtype,
      session_id: SESSION,
      is_error: true,
      errors: ['stopped before the work finished'],
      num_turns: 40,
      stop_reason: null,
      modelUsage: {},
      total_cost_usd: 0.42,
      duration_ms: 9000,
    };
  }

  it('marks a max-turns or max-budget result resumable, and no other result', () => {
    // research 01 §3 offers "resume" on exactly these two stop conditions.
    expect(apply(emptyView(), sdk(errorResult('error_max_turns'))).lastResult?.canResume).toBe(true);
    expect(apply(emptyView(), sdk(errorResult('error_max_budget_usd'))).lastResult?.canResume).toBe(true);

    // A plain mid-turn failure is one to fix, not to continue; a completed turn
    // is not "capped" at all.
    expect(apply(emptyView(), sdk(errorResult('error_during_execution'))).lastResult?.canResume).toBe(false);
    expect(
      apply(emptyView(), sdk(errorResult('error_max_structured_output_retries'))).lastResult?.canResume,
    ).toBe(false);

    const done = apply(
      emptyView(),
      sdk({
        type: 'result',
        subtype: 'success',
        session_id: SESSION,
        is_error: false,
        result: 'All done.',
        num_turns: 1,
        stop_reason: 'end_turn',
        modelUsage: {},
        total_cost_usd: 0.01,
        duration_ms: 100,
      }),
    );
    expect(done.lastResult?.canResume).toBe(false);
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

  it('ignores an envelope kind the client does not know rather than crashing', () => {
    const view = emptyView();
    const unknown = {
      v: PROTOCOL_VERSION,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'future_kind',
      payload: {},
    } as unknown as ServerEvent;

    expect(applyServerEvent(view, unknown)).toBe(view);
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
            modelUsage: {
              'claude-sonnet-5-5': {
                inputTokens: 100,
                outputTokens: 20,
                cacheReadInputTokens: 900,
                cacheCreationInputTokens: 0,
              },
            },
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
    expect(view.lastResult?.modelUsage).toEqual({
      'claude-sonnet-5-5': {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 0,
      },
    });
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

describe('chat reducer — the session the envelope names', () => {
  it('reads the session id off the envelope, not only off an init block', () => {
    // `turn_started` is a backend event: no block in it names a session, and the
    // envelope is the server's own word for which session this event is about
    // (shared/src/protocol.ts). Reading it is what keeps what `Resume` continues
    // from depending on which blocks a surface happened to fold.
    const view = applyServerEvent(emptyView(), stamped(turnStarted, SESSION));

    expect(view.sessionId).toBe(SESSION);
  });

  it('keeps the identity when a snapshot carries no init block to rebuild it from', () => {
    // The snapshot replaces the whole view, so a client that reconnects has
    // nothing left of its own to tell it where it is; the envelope is it.
    const view = applyServerEvent(emptyView(), stamped(snapshot([], 'idle'), SESSION));

    expect(view.sessionId).toBe(SESSION);
  });

  it('leaves the identity alone when the envelope names no session', () => {
    // A run that has not named a session yet says nothing about identity — not
    // that the session is gone (a cleared project is answerable with a snapshot
    // that carries no session at all).
    const named: ChatView = { ...emptyView(), sessionId: SESSION };

    expect(applyServerEvent(named, turnStarted).sessionId).toBe(SESSION);
    expect(applyServerEvent(named, snapshot([], 'idle')).sessionId).toBeNull();
  });
});

describe('chat reducer — a conversation the SDK discards', () => {
  const NEXT_SESSION = '00000000-0000-4000-8000-0000000000bb';

  const approval: ApprovalRequestPayload = {
    requestId: 'req_1',
    toolUseID: 'tu_1',
    toolName: 'Bash',
    input: { command: 'rm -rf build' },
  };

  const reset: SDKMessage = {
    type: 'conversation_reset',
    new_conversation_id: NEXT_SESSION,
    session_id: SESSION,
    trigger: 'clear',
  };

  /** A view mid-turn: a transcript on screen, a turn nobody ended, an approval parked. */
  function midTurn(): ChatView {
    return {
      ...emptyView(),
      sessionId: SESSION,
      state: 'running',
      entries: [
        { kind: 'user', text: 'hello' },
        { kind: 'assistant', text: 'before the clear' },
      ],
      streamingText: 'par',
      progress: { toolName: 'Bash', elapsedSeconds: 3 },
      pendingApprovals: [approval],
    };
  }

  it('drops everything the discarded conversation put on screen, and nothing of the run', () => {
    const view = applyServerEvent(midTurn(), stamped(sdk(reset), NEXT_SESSION));

    // The transcript goes with the conversation it belonged to …
    expect(view.entries).toEqual([]);
    expect(view.streamingText).toBe('');
    expect(view.progress).toBeNull();
    // … while the run is still the run: a turn in flight, and what it is parked on.
    expect(view.state).toBe('running');
    expect(view.pendingApprovals).toEqual([approval]);
    // And the chat is in the conversation the server says it is in.
    expect(view.sessionId).toBe(NEXT_SESSION);
  });

  it('lands on the same view live as rebuilt from the run’s snapshot', () => {
    // The two paths a reset reaches a view by — folded live, and rebuilt from the
    // run's buffer on a reconnect — have to agree, or a reconnect brings the
    // cleared transcript back.
    const live = applyServerEvent(midTurn(), stamped(sdk(reset), NEXT_SESSION));
    const rebuilt = applyServerEvent(
      midTurn(),
      stamped(snapshot([], 'running', [approval]), NEXT_SESSION),
    );

    expect(live).toEqual(rebuilt);
  });
});

describe('chat reducer — history through the same renderer', () => {
  // A stored transcript: the same turns a live run produces, but as the REST
  // endpoint's `SessionMessage[]` (server/src/sessions.ts, shared/src/session.ts).
  const transcript: readonly SessionMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'run the tests' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm test' } }],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'All green.' }] },
  ];

  it('folds a transcript into the live entries: text, a tool card, its collapsed result', () => {
    const view = fromSessionMessages(transcript);

    expect(view.entries).toEqual([
      { kind: 'user', text: 'run the tests' },
      { kind: 'assistant', text: 'On it.' },
      {
        kind: 'tool',
        toolUseId: 'tu_1',
        name: 'Bash',
        input: { command: 'npm test' },
        result: { content: 'ok', isError: false },
        children: [],
      },
      { kind: 'assistant', text: 'All green.' },
    ]);
  });

  it('renders a stored thinking block as the same collapsible entry live produces', () => {
    const view = fromSessionMessages([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'pondering' }] }]);

    expect(view.entries).toEqual([{ kind: 'thinking', text: 'pondering' }]);
  });

  it('nests a stored subagent frame under the tool card it belongs to', () => {
    const view = fromSessionMessages([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'task_1', name: 'Task', input: { description: 'explore' } }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_inner', name: 'Grep', input: { pattern: 'x' } }],
        parentToolUseId: 'task_1',
      },
      { role: 'assistant', content: [{ type: 'text', text: 'found it' }], parentToolUseId: 'task_1' },
    ]);

    expect(view.entries).toHaveLength(1);
    const card = view.entries[0];
    if (card?.kind !== 'tool') throw new Error('expected a tool card');
    expect(card.children).toEqual([
      { kind: 'tool', toolUseId: 'tu_inner', name: 'Grep', input: { pattern: 'x' }, result: null, children: [] },
      { kind: 'assistant', text: 'found it' },
    ]);
  });

  it('renders an empty history as an empty view, not an error', () => {
    const view = fromSessionMessages([]);

    expect(view.entries).toEqual([]);
    expect(view.state).toBe('idle');
  });

  it('agrees with the live fold for the same conversation — one renderer, not two', () => {
    // The identical turns, as SDK messages on the live path.
    const live = applyServerEvent(
      applyServerEvent(
        applyServerEvent(
          applyServerEvent(emptyView(), sdk(assistantText('On it.'))),
          sdk(toolUse('tu_1', 'Bash', { command: 'npm test' })),
        ),
        sdk({
          type: 'user',
          session_id: SESSION,
          parent_tool_use_id: null,
          isSynthetic: true,
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
          },
        }),
      ),
      sdk(assistantText('All green.')),
    );

    // The history fold of the same turns (minus the leading user prompt, which
    // the live path here never saw) is entry-for-entry identical.
    expect(fromSessionMessages(transcript).entries.slice(1)).toEqual(live.entries);
  });

  it('rebuilds the same entries from a reconnect snapshot as from the transcript', () => {
    // A running turn buffered these blocks; a reloaded socket receives them in
    // `snapshot.blocks` and must land on the same view history reads back.
    const recovered = applyServerEvent(
      emptyView(),
      snapshot(
        [
          toolUse('tu_1', 'Bash', { command: 'npm test' }),
          {
            type: 'user',
            session_id: SESSION,
            parent_tool_use_id: null,
            isSynthetic: true,
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }],
            },
          },
          assistantText('All green.'),
        ],
        'idle',
      ),
    );

    expect(recovered.entries).toEqual([
      {
        kind: 'tool',
        toolUseId: 'tu_1',
        name: 'Bash',
        input: { command: 'npm test' },
        result: { content: 'ok', isError: false },
        children: [],
      },
      { kind: 'assistant', text: 'All green.' },
    ]);
  });
});

describe('chat reducer — the resume target', () => {
  it('arms the next send with a target and shows it, sending no prompt itself', () => {
    const view = withResumeTarget(emptyView(), { sessionId: SESSION, fork: true });

    expect(view.resumeTarget).toEqual({ sessionId: SESSION, fork: true });
    // Nothing was rendered as if a turn had happened.
    expect(view.entries).toEqual([]);
    expect(view.state).toBe('idle');
  });

  it('clears the target when the turn starts — the bus consumed it on that send', () => {
    const armed = withResumeTarget(emptyView(), { mode: 'continue' });

    expect(applyServerEvent(armed, turnStarted).resumeTarget).toBeNull();
  });

  it('keeps the target when a send is rejected, matching the bus which consumed nothing', () => {
    const armed = withResumeTarget(emptyView(), { sessionId: SESSION });
    const rejected = applyServerEvent(armed, {
      v: PROTOCOL_VERSION,
      seq: 1,
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'error',
      payload: { code: 'turn_in_progress', message: 'a turn is already running' },
    });

    expect(rejected.resumeTarget).toEqual({ sessionId: SESSION });
  });
});

describe('chat reducer — the commands the menu offers', () => {
  /** The run's own list, pushed as it starts: a control answer, not a message. */
  function listed(commands: readonly SlashCommand[]): ServerEvent {
    seq += 1;
    return {
      v: PROTOCOL_VERSION,
      seq,
      ts: '2026-01-01T00:00:00.000Z',
      kind: 'commands',
      payload: { commands },
    };
  }

  /** The SDK's own mid-session push: the whole list, to replace what was cached. */
  function changed(commands: readonly SlashCommand[]): SDKMessage {
    return { type: 'system', subtype: 'commands_changed', session_id: SESSION, commands };
  }

  /** An init whose run binds some commands to its own terminal. */
  function initWithTerminal(terminal: readonly string[]): SDKMessage {
    return { ...init, terminal_slash_commands: terminal };
  }

  it('takes the run’s list from the push that starts it, and hands the menu its names', () => {
    const view = apply(
      emptyView(),
      listed([{ name: 'code-review', description: 'Review the diff.', argumentHint: '[low|high]' }]),
    );

    expect(view.commands).toEqual([
      { name: 'code-review', description: 'Review the diff.', argumentHint: '[low|high]' },
    ]);
  });

  it('replaces the list on a commands_changed push, never merging into it', () => {
    // The SDK's own words: "clients should REPLACE their cached command list".
    // A merge would leave a command this session no longer has on offer.
    const view = apply(
      emptyView(),
      listed([{ name: 'gone' }, { name: 'kept' }]),
      sdk(changed([{ name: 'kept' }])),
    );

    expect(view.commands).toEqual([{ name: 'kept' }]);
  });

  it('hides the commands the run binds to its own terminal — in either order', () => {
    // `/exit` and `/statusline` are real commands of a *local* terminal, and the
    // SDK's own note on the field says a remote UI should hide them. clodeck is
    // one, so the menu does.
    const after = apply(
      emptyView(),
      sdk(initWithTerminal(['statusline'])),
      listed([{ name: 'statusline' }, { name: 'clear' }]),
    );
    const before = apply(
      emptyView(),
      listed([{ name: 'statusline' }, { name: 'clear' }]),
      sdk(initWithTerminal(['statusline'])),
    );

    expect(after.commands).toEqual([{ name: 'clear' }]);
    expect(before.commands).toEqual([{ name: 'clear' }]);
  });

  it('reads the run’s list out of a snapshot, and lets a push inside it win', () => {
    /** A snapshot as the bus stamps it, with the run's list in the field of its own. */
    function opened(blocks: readonly SDKMessage[], commands: readonly SlashCommand[]): ServerEvent {
      seq += 1;
      return {
        v: PROTOCOL_VERSION,
        seq,
        ts: '2026-01-01T00:00:00.000Z',
        kind: 'snapshot',
        payload: { state: 'idle', blocks, pendingApprovals: [], commands, lastSeq: 0 },
      };
    }

    // The list is not a block, so it rides the snapshot in a field of its own —
    // without it, a reconnect would drop the run's list and the menu would fall
    // back to the project's files alone.
    expect(apply(emptyView(), opened([], [{ name: 'restored' }])).commands).toEqual([
      { name: 'restored' },
    ]);

    // Replying the session replays its blocks too, and a `commands_changed` the
    // run pushed later in the session is fresher than the list recorded when it
    // started — so the blocks are folded *after* the field.
    const fresher = changed([{ name: 'fresher' }]);
    expect(apply(emptyView(), opened([fresher], [{ name: 'stale' }])).commands).toEqual([
      { name: 'fresher' },
    ]);
  });

  it('drops a row with nothing to type, and invents no words for the rest', () => {
    // Two doors onto this shape are the wire's: a row without a name is a slash
    // and a blank, and a command whose file declared no description shows none.
    const view = apply(
      emptyView(),
      listed([{ name: '' }, { name: '' }, { name: 'bare' }, { name: 'full', description: 'Does a thing.' }] as SlashCommand[]),
    );

    expect(view.commands).toEqual([{ name: 'bare' }, { name: 'full', description: 'Does a thing.' }]);
  });
});
