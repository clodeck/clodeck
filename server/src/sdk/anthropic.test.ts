import type {
  CanUseTool,
  PermissionUpdate,
  SessionMessage as SdkSessionMessage,
  SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk';

import type { ApprovalRequestPayload } from '@clodeck/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeSessionInfo,
  normalizeSessionMessage,
  providerEnv,
  toSdkCanUseTool,
} from './anthropic.js';

/**
 * The real provider is the only module that loads the SDK, so its translations
 * are the ones the fake cannot stand in for: the two history normalizations, the
 * `canUseTool` shape bridge, and the environment a run's subprocess gets. They
 * are pure, so they are tested directly — fixtures are plain data cast once to
 * the SDK's own types, the way `mirror.test.ts` casts them; re-running our own
 * code to build an expectation would only prove the cast.
 */

function info(fields: Record<string, unknown>): SDKSessionInfo {
  return fields as SDKSessionInfo;
}

function entry(fields: Record<string, unknown>): Parameters<typeof normalizeSessionMessage>[0] {
  return fields as Parameters<typeof normalizeSessionMessage>[0];
}

function titleOf(fields: Record<string, unknown>): string {
  return normalizeSessionInfo(
    info({ sessionId: 's1', summary: '', lastModified: 1_700_000_000_000, ...fields }),
  ).title;
}

describe('normalizeSessionInfo', () => {
  it('falls back customTitle → summary → firstPrompt → "Untitled"', () => {
    // `summary` is required by the SDK but can be empty, which is what keeps the
    // later fallbacks reachable — an empty value counts as absent at every step.
    expect(titleOf({ customTitle: 'renamed', summary: 'auto' })).toBe('renamed');
    expect(titleOf({ summary: 'auto', firstPrompt: 'first' })).toBe('auto');
    expect(titleOf({ customTitle: '', summary: '', firstPrompt: 'first' })).toBe('first');
    expect(titleOf({})).toBe('Untitled');
  });

  it('maps the session id and the epoch-millisecond timestamps to ISO 8601', () => {
    const summary = normalizeSessionInfo(
      info({
        sessionId: 'a1b2c3',
        summary: 'a chat',
        lastModified: 1_700_000_000_000,
        createdAt: 1_690_000_000_000,
        tag: 'work',
      }),
    );

    expect(summary).toEqual({
      id: 'a1b2c3',
      title: 'a chat',
      createdAt: '2023-07-22T04:26:40.000Z',
      lastModified: '2023-11-14T22:13:20.000Z',
      tag: 'work',
    });
  });

  it('omits createdAt when the SDK store did not record one', () => {
    const summary = normalizeSessionInfo(info({ sessionId: 's1', summary: 's', lastModified: 1_700_000_000_000 }));

    expect(summary.createdAt).toBeUndefined();
    expect(Object.keys(summary).sort()).toEqual(['id', 'lastModified', 'title']);
  });

  it('drops the SDK fields the picker does not use yet', () => {
    const summary = normalizeSessionInfo(
      info({
        sessionId: 's1',
        summary: 's',
        lastModified: 1_700_000_000_000,
        fileSize: 4096,
        cwd: '/projects/a',
        gitBranch: 'main',
      }),
    );

    expect(Object.keys(summary).sort()).toEqual(['id', 'lastModified', 'title']);
  });
});

describe('normalizeSessionMessage', () => {
  it('passes complete content blocks through and names the tool the entry is about', () => {
    const message = entry({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me look' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
      parent_tool_use_id: null,
    });

    expect(normalizeSessionMessage(message)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
      ],
      toolUseId: 't1',
    });
  });

  it('wraps a plain-string prompt as one text block, so history and live share a renderer', () => {
    const message = entry({ type: 'user', message: { role: 'user', content: 'hello' } });

    expect(normalizeSessionMessage(message)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('links a tool result to the tool use it answers and keeps its subagent frame', () => {
    const message = entry({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] },
      parent_tool_use_id: 't1',
    });

    expect(normalizeSessionMessage(message)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }],
      toolUseId: 't2',
      parentToolUseId: 't1',
    });
  });

  it('keeps blocks only, and answers an empty transcript for an unreadable entry', () => {
    // `SessionMessage.message` is `unknown` in the SDK — it is persisted JSON, not a
    // typed shape — so anything that is not a block is dropped rather than forwarded.
    const blocked = entry({
      type: 'assistant',
      message: { role: 'assistant', content: ['not a block', { type: 'text', text: 'ok' }] },
    });
    const unreadable = entry({ type: 'user', message: 'not an object' });

    expect(normalizeSessionMessage(blocked).content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(normalizeSessionMessage(unreadable)).toEqual({ role: 'user', content: [] });
  });
});

describe('toSdkCanUseTool', () => {
  function sdkOptions(extra: Partial<Parameters<CanUseTool>[2]> = {}): Parameters<CanUseTool>[2] {
    return { signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1', ...extra };
  }

  it('carries the SDK question into the shared request payload', async () => {
    const suggestions: PermissionUpdate[] = [
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' },
    ];
    const seen: ApprovalRequestPayload[] = [];
    const canUseTool = toSdkCanUseTool((request) => {
      seen.push(request);
      return Promise.resolve({ requestId: request.requestId, behavior: 'allow' });
    });

    const result = await canUseTool(
      'Bash',
      { command: 'ls' },
      sdkOptions({ title: 'Run a command', displayName: 'Bash', suggestions, defaultToNo: true }),
    );

    expect(seen).toEqual([
      {
        requestId: 'r1',
        toolUseID: 't1',
        toolName: 'Bash',
        input: { command: 'ls' },
        title: 'Run a command',
        displayName: 'Bash',
        suggestions,
        defaultToNo: true,
      },
    ]);
    expect(result).toEqual({ behavior: 'allow' });
  });

  it('maps an allow with edits and a deny reason back to the SDK result shape', async () => {
    const allow = toSdkCanUseTool(() =>
      Promise.resolve({ requestId: 'r1', behavior: 'allow', updatedInput: { command: 'ls -la' } }),
    );
    const deny = toSdkCanUseTool(() =>
      Promise.resolve({ requestId: 'r1', behavior: 'deny', message: 'not that file' }),
    );
    const silentDeny = toSdkCanUseTool(() => Promise.resolve({ requestId: 'r1', behavior: 'deny' }));

    expect(await allow('Bash', { command: 'ls' }, sdkOptions())).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
    });
    expect(await deny('Read', {}, sdkOptions())).toEqual({ behavior: 'deny', message: 'not that file' });
    // The SDK's deny arm requires a message, so a silent deny still says something.
    expect((await silentDeny('Read', {}, sdkOptions())) as { message: string }).toHaveProperty('message');
  });
});

describe('providerEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets no env at all when the run carries no provider', () => {
    // Today's behaviour, kept: `toSdkOptions` has nothing to assign, so the
    // subprocess inherits the environment this process was started with.
    expect(providerEnv(undefined)).toBeNull();
  });

  it('leaves the ambient environment standing and overrides the three provider keys', () => {
    vi.stubEnv('CLODECK_AMBIENT_MARKER', 'kept');
    vi.stubEnv('ANTHROPIC_MODEL', 'the-ambient-model');

    const env = providerEnv({
      baseUrl: 'https://gateway.example',
      authToken: 'a-token',
      model: 'deepseek-flash',
    });

    // `Options.env` replaces the subprocess environment, so every variable the
    // provider has no opinion about has to survive the spread.
    expect(env?.['CLODECK_AMBIENT_MARKER']).toBe('kept');
    expect(env?.['PATH']).toBe(process.env['PATH']);
    expect(env?.['ANTHROPIC_BASE_URL']).toBe('https://gateway.example');
    expect(env?.['ANTHROPIC_AUTH_TOKEN']).toBe('a-token');
    expect(env?.['ANTHROPIC_MODEL']).toBe('deepseek-flash');
  });

  it('leaves a key the provider does not carry at its ambient value', () => {
    // A profile may declare only an endpoint and its credential; the model is
    // then the endpoint's own decision, not an empty one sent on its behalf.
    vi.stubEnv('ANTHROPIC_MODEL', 'the-ambient-model');

    const env = providerEnv({ baseUrl: 'https://gateway.example', authToken: 'a-token' });

    expect(env?.['ANTHROPIC_MODEL']).toBe('the-ambient-model');
  });
});
