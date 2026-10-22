import path from 'node:path';

import type {
  CanUseTool,
  PermissionUpdate,
  PreToolUseHookInput,
  SessionMessage as SdkSessionMessage,
  SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk';

import type { ApprovalRequestPayload, PermissionMode } from '@clodeck/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bashApprovalHooks,
  normalizeSessionInfo,
  normalizeSessionMessage,
  planDenialHooks,
  providerEnv,
  toSdkCanUseTool,
  toSdkOptions,
} from './anthropic.js';
import { BASH_APPROVAL_REASON } from './bash-approval.js';
import { PLAN_DENIAL_REASON, plansDirectory } from './plan-denial.js';

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

/** The event the SDK hands a `PreToolUse` hook; the rest of the fields are not read. */
function event(toolName: string, toolInput: unknown = {}): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    transcript_path: '/tmp/s1.jsonl',
    cwd: '/projects/a',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 't1',
  };
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

  it('carries the gate’s own reason into the payload, and leaves it absent otherwise', async () => {
    const seen: ApprovalRequestPayload[] = [];
    const canUseTool = toSdkCanUseTool((request) => {
      seen.push(request);
      return Promise.resolve({ requestId: request.requestId, behavior: 'allow' });
    });

    await canUseTool('Bash', { command: 'ls' }, sdkOptions({ decisionReason: 'because' }));
    await canUseTool('Bash', { command: 'ls' }, sdkOptions());

    expect(seen[0]?.decisionReason).toBe('because');
    // An absent reason stays absent: the wire carries no empty field for the
    // modal to render as a blank line.
    expect(seen[1]).not.toHaveProperty('decisionReason');
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

describe('bashApprovalHooks', () => {
  function hookFor(mode: PermissionMode) {
    return bashApprovalHooks(mode)?.PreToolUse?.[0]?.hooks[0];
  }

  it('answers ask for every Bash call in Ask and Accept edits, with its reason', async () => {
    for (const mode of ['default', 'acceptEdits'] as const) {
      // The matcher is what keeps the hook to Bash in the first place; the name
      // check inside is the same promise made for a caller that skips it.
      expect(bashApprovalHooks(mode)?.PreToolUse?.[0]?.matcher).toBe('Bash');

      const hook = hookFor(mode);
      const result = await hook?.(event('Bash'), 't1', { signal: new AbortController().signal });

      expect(result).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: BASH_APPROVAL_REASON,
        },
      });
    }
  });

  it('is not registered in Plan or Bypass', () => {
    // Plan denies Bash without a prompt (ticket 84); Bypass never asks (85).
    expect(bashApprovalHooks('plan')).toBeUndefined();
    expect(bashApprovalHooks('bypassPermissions')).toBeUndefined();
  });

  it('leaves every other tool to the project’s rules', async () => {
    const hook = hookFor('default');

    // Read/Glob/Grep are pre-approved, Write/Edit are Accept-edits' business,
    // and AskUserQuestion keeps its own gate — none of them is Bash's prompt.
    for (const toolName of ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'AskUserQuestion']) {
      await expect(
        hook?.(event(toolName), 't1', { signal: new AbortController().signal }),
      ).resolves.toEqual({ continue: true });
    }
  });
});

describe('planDenialHooks', () => {
  function hookFor(mode: PermissionMode) {
    return planDenialHooks(mode)?.PreToolUse?.[0]?.hooks[0];
  }

  function decide(toolName: string, toolInput: unknown = {}) {
    return hookFor('plan')?.(event(toolName, toolInput), 't1', {
      signal: new AbortController().signal,
    });
  }

  it('is registered in Plan alone', () => {
    expect(planDenialHooks('plan')).toBeDefined();
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'auto'] as const) {
      expect(planDenialHooks(mode)).toBeUndefined();
    }
  });

  it('denies edits, commands and ExitPlanMode with a reason the model reads', async () => {
    for (const [toolName, toolInput] of [
      ['Write', { file_path: '/projects/a/a.ts', content: 'x' }],
      ['Edit', { file_path: '/projects/a/a.ts', old_string: 'a', new_string: 'b' }],
      ['Bash', { command: 'ls' }],
      ['ExitPlanMode', {}],
    ] as const) {
      await expect(decide(toolName, toolInput)).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: PLAN_DENIAL_REASON,
        },
      });
    }
  });

  it('falls through for the clarifying question, the reads, and the plan file', async () => {
    for (const toolName of ['AskUserQuestion', 'Read', 'Glob', 'Grep']) {
      await expect(decide(toolName)).resolves.toEqual({ continue: true });
    }

    await expect(
      decide('Write', { file_path: path.join(plansDirectory(), 'plan.md'), content: '# plan' }),
    ).resolves.toEqual({ continue: true });
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

/**
 * The one run-level option Bypass needs (ticket 85). The capability is a
 * property of the run, not of the mode: the SDK reads it once at `query()`
 * time, and a mid-turn switch has to be possible, so a run the gates allow
 * carries it whatever mode it starts in. A run they refuse does not carry it at
 * all — the SDK's own refusal is then the second lock on the same door.
 */
describe('the skip-permissions capability', () => {
  function options(allowBypass?: boolean): ReturnType<typeof toSdkOptions> {
    return toSdkOptions(
      { cwd: '/projects/a', prompt: 'hi', permissionMode: 'default', allowBypass },
      new AbortController(),
    );
  }

  it('is set on a run the gates allow, in every mode it starts in', () => {
    expect(options(true).allowDangerouslySkipPermissions).toBe(true);
    // Not only when the run starts in Bypass: the switch may come mid-turn.
    const inPlan = toSdkOptions(
      { cwd: '/projects/a', prompt: 'hi', permissionMode: 'plan', allowBypass: true },
      new AbortController(),
    );
    expect(inPlan.allowDangerouslySkipPermissions).toBe(true);
  });

  it('is absent on a run the gates refuse — including when the input says nothing', () => {
    expect(options(false).allowDangerouslySkipPermissions).toBeUndefined();
    expect(options().allowDangerouslySkipPermissions).toBeUndefined();
  });
});

/**
 * Bypass carries no `PreToolUse` hook (ticket 85). That absence *is* the gate's
 * promise: with nothing in front of them, the project's own deny and ask rules
 * still decide, exactly as the warning says — while every hook clodeck adds
 * would run first and could only narrow them.
 */
describe('the hooks Bypass registers', () => {
  it('registers neither of the two gates clodeck adds', () => {
    expect(bashApprovalHooks('bypassPermissions')).toBeUndefined();
    expect(planDenialHooks('bypassPermissions')).toBeUndefined();

    const bypass = toSdkOptions(
      { cwd: '/projects/a', prompt: 'hi', permissionMode: 'bypassPermissions', allowBypass: true },
      new AbortController(),
    );
    expect(bypass.hooks).toBeUndefined();
  });
});
