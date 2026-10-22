import type { BypassAvailability } from '@clodeck/shared';

/**
 * The two gates that can refuse **Bypass**, in one place (ticket 85, decision
 * 10). The mode is the widest thing the product offers — every tool runs without
 * asking — so clodeck never lets it be chosen by accident:
 *
 * 1. the deployment's `CLODECK_ALLOW_BYPASS`, read once at boot and on by
 *    default, so a single-user server keeps the option;
 * 2. the project's own `permissions.disableBypassPermissionsMode: "disable"`,
 *    which outranks every session in it.
 *
 * The SDK's own refusal to run Bypass as root is deliberately not here: clodeck
 * cannot see it before the run starts, and the ticket's rule is that it fails
 * **closed** and out loud rather than falling back to a quieter mode.
 *
 * Both answers travel to the client on the snapshot, with the reason, because a
 * gate the user cannot see is not a gate (decision 12).
 */

/** Why Bypass is refused when the deployment switched it off. */
export const BYPASS_OFF_BY_SERVER =
  'Bypass is off on this server: CLODECK_ALLOW_BYPASS is off.';

/** Why Bypass is refused when the project's own settings do. */
export const BYPASS_OFF_BY_PROJECT =
  'This project disables Bypass in .claude/settings.json (permissions.disableBypassPermissionsMode).';

/** The two facts the gates are read from, named so a call site says which is which. */
export interface BypassGates {
  /** The deployment's `CLODECK_ALLOW_BYPASS`. */
  allowBypass: boolean;
  /** The project's own `permissions.disableBypassPermissionsMode: "disable"`. */
  projectDisabled: boolean;
}

/**
 * The gates combined into the one answer a surface can render.
 *
 * The deployment's gate is checked first: when both say no, the one the user
 * cannot change from the drawer is the one worth naming — and an operator who
 * has switched Bypass off has said it should never run, whatever a project
 * happens to declare.
 */
export function bypassAvailability(gates: BypassGates): BypassAvailability {
  if (!gates.allowBypass) return { allowed: false, reason: BYPASS_OFF_BY_SERVER };
  if (gates.projectDisabled) return { allowed: false, reason: BYPASS_OFF_BY_PROJECT };
  return { allowed: true };
}
