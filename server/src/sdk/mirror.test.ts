import type { SDKMessage as RealSDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { describe, expect, it } from 'vitest';

import { narrowToMirror } from './mirror.js';

/**
 * Fixtures are plain data cast once to the real union: the real members are far
 * too wide to construct in full (a `BetaMessage` alone carries a dozen nulls),
 * and the compile-time proof that the mirror is wide enough is `tsc` checking
 * `mirror.ts`'s assignments — not these fixtures. What these tests pin is the
 * *runtime* dispatch: which real family becomes which mirrored family, and which
 * fall away.
 */
function real(message: Record<string, unknown>): RealSDKMessage {
  return message as RealSDKMessage;
}

describe('narrowToMirror', () => {
  it('passes a mirrored family through unmodified', () => {
    const assistant = real({
      type: 'assistant',
      session_id: 's1',
      parent_tool_use_id: null,
      uuid: '00000000-0000-0000-0000-000000000000',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    });

    expect(narrowToMirror(assistant)).toBe(assistant);
  });

  it('passes both user arms through — the live send and the replayed one', () => {
    // `SDKUserMessage.uuid`/`session_id` are optional; `SDKUserMessageReplay`
    // promotes them and adds `isReplay`. Both share `type: 'user'`.
    const live = real({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
    });
    const replay = real({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
      uuid: '11111111-1111-1111-1111-111111111111',
      session_id: 's1',
      isReplay: true,
    });

    expect(narrowToMirror(live)).toBe(live);
    expect(narrowToMirror(replay)).toBe(replay);
  });

  it('passes the live indicator and the partial stream through', () => {
    const progress = real({
      type: 'tool_progress',
      tool_use_id: 't1',
      tool_name: 'Bash',
      parent_tool_use_id: null,
      elapsed_time_seconds: 3,
      uuid: '22222222-2222-2222-2222-222222222222',
      session_id: 's1',
    });
    const streamEvent = real({
      type: 'stream_event',
      session_id: 's1',
      parent_tool_use_id: null,
      uuid: '33333333-3333-3333-3333-333333333333',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'he' } },
    });

    expect(narrowToMirror(progress)).toBe(progress);
    expect(narrowToMirror(streamEvent)).toBe(streamEvent);
  });

  it('keeps every system subtype — the three the client renders and the rest', () => {
    // `system` is one `type` with ~28 `subtype`s; the second discriminant is the
    // one that must not be dropped, so this exercises both a specifically
    // mirrored subtype and one that folds into the catch-all arm.
    const init = real({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      cwd: '/projects/clodeck',
      model: 'claude-sonnet-5-5',
      permissionMode: 'default',
      tools: [],
      uuid: '44444444-4444-4444-4444-444444444444',
    });
    const status = real({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: 's1',
      uuid: '55555555-5555-5555-5555-555555555555',
    });
    const state = real({
      type: 'system',
      subtype: 'session_state_changed',
      state: 'running',
      session_id: 's1',
      uuid: '66666666-6666-6666-6666-666666666666',
    });
    const taskStarted = real({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      description: 'a subagent',
      session_id: 's1',
      uuid: '77777777-7777-7777-7777-777777777777',
    });

    for (const message of [init, status, state, taskStarted]) {
      expect(narrowToMirror(message)).toBe(message);
    }
  });

  it('keeps both result arms — the turn summary and each way it ends badly', () => {
    const success = real({
      type: 'result',
      subtype: 'success',
      session_id: 's1',
      is_error: false,
      result: 'done',
      num_turns: 1,
      stop_reason: 'end_turn',
      total_cost_usd: 0.01,
      duration_ms: 1200,
      duration_api_ms: 900,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      uuid: '88888888-8888-8888-8888-888888888888',
    });
    const errorSubtypes = [
      'error_during_execution',
      'error_max_turns',
      'error_max_budget_usd',
      'error_max_structured_output_retries',
    ];
    const errors = errorSubtypes.map((subtype) =>
      real({
        type: 'result',
        subtype,
        session_id: 's1',
        is_error: true,
        errors: ['boom'],
        num_turns: 2,
        stop_reason: null,
        total_cost_usd: 0.02,
        duration_ms: 2000,
        duration_api_ms: 1500,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: '99999999-9999-9999-9999-999999999999',
      }),
    );

    expect(narrowToMirror(success)).toBe(success);
    for (const error of errors) {
      expect(narrowToMirror(error)).toBe(error);
    }
  });

  it('carries the SDK’s own conversation reset — the family the client acts on without rendering', () => {
    // Not one of the six the transcript renderer draws, but not ignorable either:
    // the frame is how the run says the conversation it was in is gone and which
    // one replaced it, and the client clears the screen on it (ticket 76). Its
    // own fields are pinned by the assignment in `mirror.ts`, as ever; what this
    // pins is that the family reaches the client rather than falling away.
    const reset = real({
      type: 'conversation_reset',
      new_conversation_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      uuid: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      session_id: 's1',
      trigger: 'clear',
      timestamp: '2026-10-16T00:00:00.000Z',
    });

    const mirrored = narrowToMirror(reset);

    expect(mirrored).toBe(reset);
    expect(mirrored?.type).toBe('conversation_reset');
  });

  it('drops the real families the client neither renders nor acts on', () => {
    // Four top-level `type`s of the real union have no mirrored family; each
    // must fall to the catch-all and become `null` rather than leak through.
    // `conversation_reset` used to be listed here and no longer is: the reason
    // the rest are unmirrored — the client has nothing to do with them — never
    // held for a frame that discards the transcript on screen (ticket 76).
    const unmirrored = [
      real({
        type: 'tool_use_summary',
        summary: 'ran Bash',
        preceding_tool_use_ids: ['t1'],
        uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        session_id: 's1',
      }),
      real({
        type: 'auth_status',
        isAuthenticating: false,
        output: [],
        uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        session_id: 's1',
      }),
      real({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed' },
        uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        session_id: 's1',
      }),
      real({
        type: 'prompt_suggestion',
        suggestion: 'try this next',
        uuid: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        session_id: 's1',
      }),
    ];

    for (const message of unmirrored) {
      expect(narrowToMirror(message)).toBeNull();
    }
  });

  it('reaches every mirrored top-level type', () => {
    // The six families the client renders (spec-02 §"SDK dependency & the mirror
    // pin") plus the reset it acts on: each must survive narrowing, so no
    // mirrored arm is dead code.
    const mirrored = [
      real({
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000001',
        message: { id: 'm1', role: 'assistant', content: [] },
      }),
      real({ type: 'user', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      real({
        type: 'tool_progress',
        tool_use_id: 't1',
        tool_name: 'Bash',
        parent_tool_use_id: null,
        elapsed_time_seconds: 1,
        uuid: '00000000-0000-0000-0000-000000000002',
        session_id: 's1',
      }),
      real({
        type: 'stream_event',
        session_id: 's1',
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000003',
        event: { type: 'message_stop' },
      }),
      real({
        type: 'result',
        subtype: 'success',
        session_id: 's1',
        is_error: false,
        result: 'done',
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        duration_ms: 1,
        duration_api_ms: 1,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: '00000000-0000-0000-0000-000000000004',
      }),
      real({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'idle',
        session_id: 's1',
        uuid: '00000000-0000-0000-0000-000000000005',
      }),
      real({
        type: 'conversation_reset',
        new_conversation_id: '00000000-0000-0000-0000-000000000006',
        uuid: '00000000-0000-0000-0000-000000000006',
        session_id: 's1',
        trigger: 'clear',
      }),
    ];

    const reached = mirrored.map((message) => narrowToMirror(message)?.type).sort();

    expect(reached).toEqual([
      'assistant',
      'conversation_reset',
      'result',
      'stream_event',
      'system',
      'tool_progress',
      'user',
    ]);
  });
});
