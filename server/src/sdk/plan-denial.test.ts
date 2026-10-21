import { homedir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { planDeniesTools, planToolDecision, plansDirectory } from './plan-denial.js';

/**
 * Plan refuses edits and commands outright, without the modal, and lets three
 * exceptions through: the clarifying question, reads and searches, and the
 * SDK's own plan file. This is the one list the real provider's hook and the
 * fake's emulation share, so each exception is pinned here.
 */
describe('planDeniesTools', () => {
  it('is the gate of Plan alone', () => {
    expect(planDeniesTools('plan')).toBe(true);
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'auto'] as const) {
      expect(planDeniesTools(mode)).toBe(false);
    }
  });
});

describe('planToolDecision', () => {
  const CWD = '/projects/alpha';

  it('denies Write and Edit outside the SDK’s plans directory', () => {
    expect(planToolDecision('Write', { file_path: path.join(CWD, 'a.ts') }, CWD)).toBe('deny');
    expect(planToolDecision('Edit', { file_path: path.join(CWD, 'a.ts') }, CWD)).toBe('deny');
    // A write whose path the tool input cannot name is still a write.
    expect(planToolDecision('Write', { content: 'x' }, CWD)).toBe('deny');
  });

  it('denies every Bash call, read-only commands included', () => {
    expect(planToolDecision('Bash', { command: 'ls' }, CWD)).toBe('deny');
    expect(planToolDecision('Bash', { command: 'git status' }, CWD)).toBe('deny');
  });

  it('denies ExitPlanMode, so the session stays in Plan', () => {
    expect(planToolDecision('ExitPlanMode', {}, CWD)).toBe('deny');
  });

  it('lets the clarifying question through to the modal', () => {
    expect(planToolDecision('AskUserQuestion', { questions: [] }, CWD)).toBe('pass');
  });

  it('leaves reads and searches free', () => {
    for (const toolName of ['Read', 'Glob', 'Grep']) {
      expect(planToolDecision(toolName, { file_path: path.join(CWD, 'a.ts') }, CWD)).toBe('pass');
    }
  });

  it('lets the SDK write its own plan file, absolute or relative to the run', () => {
    const planFile = path.join(plansDirectory(), 'plan.md');
    expect(planToolDecision('Write', { file_path: planFile }, CWD)).toBe('pass');
    expect(planToolDecision('Edit', { file_path: planFile }, CWD)).toBe('pass');

    // The model can spell the same file relative to the run's cwd.
    const relative = path.relative(CWD, planFile);
    expect(planToolDecision('Write', { file_path: relative }, CWD)).toBe('pass');
  });

  it('does not mistake a lookalike path for the plans directory', () => {
    const sibling = `${plansDirectory()}-backup`;
    expect(planToolDecision('Write', { file_path: path.join(sibling, 'plan.md') }, CWD)).toBe('deny');
    expect(planToolDecision('Write', { file_path: path.dirname(plansDirectory()) }, CWD)).toBe('deny');
  });
});

describe('plansDirectory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to ~/.claude/plans', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '');
    expect(plansDirectory()).toBe(path.join(homedir(), '.claude', 'plans'));
  });

  it('follows CLAUDE_CONFIG_DIR when the SDK’s config home moves', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/srv/claude-config');
    expect(plansDirectory()).toBe(path.join('/srv/claude-config', 'plans'));
  });
});
