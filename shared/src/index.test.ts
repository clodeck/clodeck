import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type FileContent,
  type FileEntry,
  type Project,
  type SDKMessage,
  type ServerEvent,
  type SessionMessage,
  type SessionSummary,
} from './index.js';

/** Describes every event kind; a new kind makes this fail to compile. */
function labelOf(event: ServerEvent): string {
  switch (event.kind) {
    case 'sdk':
      return `sdk:${event.payload.type}`;
    case 'approval_request':
      return `approval_request:${event.payload.toolName}`;
    case 'snapshot':
      return `snapshot:${String(event.payload.blocks.length)}`;
    case 'stream_status':
      return `stream_status:${event.payload.status}`;
    case 'error':
      return `error:${event.payload.code}`;
    default: {
      const unhandled: never = event;
      throw new Error(`unhandled ServerEvent: ${JSON.stringify(unhandled)}`);
    }
  }
}

describe('@clodeck/shared', () => {
  it('exposes a positive integer protocol version', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('discriminates server events on kind, exhaustively', () => {
    const base = { v: PROTOCOL_VERSION, seq: 3, ts: '2026-10-09T00:00:00.000Z', projectId: 'p1' } as const;

    expect(
      labelOf({
        ...base,
        kind: 'sdk',
        payload: {
          type: 'assistant',
          session_id: 's1',
          parent_tool_use_id: null,
          message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        },
      }),
    ).toBe('sdk:assistant');
    expect(
      labelOf({
        ...base,
        kind: 'approval_request',
        payload: { requestId: 'r1', toolUseID: 't1', toolName: 'Bash', input: { command: 'ls' } },
      }),
    ).toBe('approval_request:Bash');
    expect(
      labelOf({
        ...base,
        kind: 'snapshot',
        payload: { state: 'running', blocks: [], pendingApprovals: [], lastSeq: 2 },
      }),
    ).toBe('snapshot:0');
    expect(labelOf({ ...base, kind: 'stream_status', payload: { status: 'turn_started' } })).toBe(
      'stream_status:turn_started',
    );
    expect(labelOf({ ...base, kind: 'error', payload: { code: 'busy', message: 'turn in progress' } })).toBe(
      'error:busy',
    );
  });

  it('carries all five client control messages', () => {
    const messages: ClientMessage[] = [
      { v: PROTOCOL_VERSION, id: '1', type: 'send_prompt', payload: { prompt: 'hello' } },
      { v: PROTOCOL_VERSION, id: '2', type: 'interrupt', payload: {} },
      {
        v: PROTOCOL_VERSION,
        id: '3',
        type: 'approval_response',
        payload: { requestId: 'r1', behavior: 'deny', message: 'not that file' },
      },
      { v: PROTOCOL_VERSION, id: '4', type: 'set_permission_mode', payload: { mode: 'plan' } },
      { v: PROTOCOL_VERSION, id: '5', type: 'resume', payload: { mode: 'continue' } },
      { v: PROTOCOL_VERSION, id: '6', type: 'resume', payload: { sessionId: 's1', fork: true } },
    ];

    expect(messages.map((message) => message.type)).toEqual([
      'send_prompt',
      'interrupt',
      'approval_response',
      'set_permission_mode',
      'resume',
      'resume',
    ]);
  });

  it('is the single source of the Project shape', () => {
    const project: Project = { id: 'L3Byb2plY3RzL2Nsb2RlY2s', name: 'clodeck', path: '/projects/clodeck' };

    expect(Object.keys(project).sort()).toEqual(['id', 'name', 'path']);
  });

  it('is the single source of the file-drawer shapes', () => {
    const entries: FileEntry[] = [
      { type: 'directory', name: 'src' },
      { type: 'file', name: 'index.ts', size: 12, mtime: '2026-10-10T00:00:00.000Z' },
      { type: 'symlink', name: 'escape' },
    ];
    const content: FileContent = { kind: 'text', content: 'hi', truncated: false, size: 2 };

    expect(entries.map((entry) => entry.type)).toEqual(['directory', 'file', 'symlink']);
    expect(Object.keys(content).sort()).toEqual(['content', 'kind', 'size', 'truncated']);
  });

  it('is the single source of the session-history shapes', () => {
    const summary: SessionSummary = {
      id: 'a1b2c3',
      title: 'a chat',
      createdAt: '2026-10-09T00:00:00.000Z',
      lastModified: '2026-10-09T01:00:00.000Z',
      tag: 'work',
    };
    // The transcript reuses the live mirror's blocks, so one renderer serves both.
    const message: SessionMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
      ],
      parentToolUseId: 't0',
    };

    expect(Object.keys(summary).sort()).toEqual(['createdAt', 'id', 'lastModified', 'tag', 'title']);
    expect(message.content.map((block) => block.type)).toEqual(['text', 'tool_use']);
  });

  it('mirrors SDK messages widely enough to read text blocks and ignore unknown ones', () => {
    // A block the client has no arm for — it arrives from the wire, not from a literal.
    const exoticBlock = { type: 'server_tool_use', id: 't9', name: 'web_search' };

    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        session_id: 's1',
        parent_tool_use_id: null,
        message: {
          id: 'm1',
          role: 'assistant',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
            exoticBlock,
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'done',
        session_id: 's1',
        is_error: false,
        num_turns: 1,
        stop_reason: 'end_turn',
        total_cost_usd: 0.01,
        duration_ms: 1200,
      },
    ];

    const texts: string[] = [];
    for (const message of messages) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          // The unknown-block member widens `type`, so a literal check pairs with a property guard.
          if (block.type === 'text' && 'text' in block) {
            texts.push(block.text);
          }
        }
      }
    }

    expect(texts).toEqual(['hello']);
  });

  it('keeps the Anthropic SDKs out of the contract package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@anthropic-ai/'))).toEqual(
      [],
    );
  });
});
