import { homedir } from 'node:os';
import path from 'node:path';

import type { PermissionMode } from '@clodeck/shared';

/**
 * Plan's gate: edits and commands are denied outright, without the approval
 * modal, so nothing runs while the plan is being written (ticket 84). Two calls
 * are deliberately not denials: `AskUserQuestion` is the clarifying question a
 * plan needs, and the SDK's own plan file under `~/.claude/plans/` is how plan
 * mode records what it planned.
 *
 * One module, because the real provider's `PreToolUse` hook and the fake's
 * emulation of it must agree on which calls Plan refuses.
 */

/** True when this run is in Plan, where edits and commands are denied without a prompt. */
export function planDeniesTools(mode: PermissionMode): boolean {
  return mode === 'plan';
}

/** The tools Plan refuses; every other tool keeps its own gate. */
const PLAN_DENIED_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'Bash', 'ExitPlanMode']);

/**
 * The model reads this and keeps planning. It names the one way out — the mode
 * chip — because Plan never prompts for `ExitPlanMode`, so the model cannot
 * approve its own way into execution.
 */
export const PLAN_DENIAL_REASON =
  'Plan mode is on — edits and commands are denied. Change the mode from the chip to run them.';

/**
 * What the gate does with one call. `pass` is not an approval: it leaves the
 * call to the SDK's own plan-mode handling, which is what lets `AskUserQuestion`
 * reach the modal and the plan file be written.
 */
export function planToolDecision(
  toolName: string,
  input: unknown,
  cwd: string,
): 'deny' | 'pass' {
  if (!PLAN_DENIED_TOOLS.has(toolName)) return 'pass';

  // The plan the model is composing is written beside the SDK's config, not in
  // the project: that write is how plan mode records its plan, and Plan must
  // not stop it. `ExitPlanMode` carries no file path, so it is never this case.
  if ((toolName === 'Write' || toolName === 'Edit') && isPlanFile(input, cwd)) return 'pass';

  return 'deny';
}

/**
 * The SDK's plans directory: `~/.claude/plans/` by default, under
 * `CLAUDE_CONFIG_DIR` when that replaces the config home. A project's
 * `plansDirectory` setting can move it, but clodeck does not read a project's
 * settings itself; the default is the path plan mode documents.
 */
export function plansDirectory(): string {
  const configured = process.env['CLAUDE_CONFIG_DIR']?.trim();
  const configHome =
    configured === undefined || configured === '' ? path.join(homedir(), '.claude') : configured;
  return path.join(configHome, 'plans');
}

/** The call writes the SDK's own plan file, which Plan lets through. */
function isPlanFile(input: unknown, cwd: string): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const filePath = (input as { file_path?: unknown }).file_path;
  if (typeof filePath !== 'string') return false;

  return isWithin(plansDirectory(), path.resolve(cwd, filePath));
}

/**
 * Lexical containment, not `realpath`: the plan file does not exist yet when the
 * hook sees the call. A sibling whose name merely starts with the directory's
 * (`plans-backup`) must not pass, so the boundary is checked as a path segment.
 */
function isWithin(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
