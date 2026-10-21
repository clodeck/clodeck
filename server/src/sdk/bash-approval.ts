import type { PermissionMode } from '@clodeck/shared';

/**
 * In Ask and Accept edits, every Bash call is parked at the approval modal —
 * `ls` and `git status` as much as `rm` and `sed` (ticket 83). Plan denies Bash
 * without a prompt (ticket 84) and Bypass never asks (ticket 85), so neither
 * carries the gate.
 *
 * One list, because the real provider's hook and the fake's emulation of it
 * must agree on when the gate exists.
 */
const BASH_APPROVAL_MODES: ReadonlySet<PermissionMode> = new Set(['default', 'acceptEdits']);

/** True when this run's Bash calls go through `canUseTool` whatever the project's rules say. */
export function bashNeedsApproval(mode: PermissionMode): boolean {
  return BASH_APPROVAL_MODES.has(mode);
}

/**
 * What the hook tells `canUseTool`, which carries it to the client as the
 * request's `decisionReason` and into the modal. It says why the prompt is up
 * when no project rule explains it — short, because the command sits beside it.
 */
export const BASH_APPROVAL_REASON = 'Bash commands always ask for approval in this mode.';
