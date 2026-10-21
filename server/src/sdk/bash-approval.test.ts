import { describe, expect, it } from 'vitest';

import { bashNeedsApproval } from './bash-approval.js';

/**
 * The one list the real provider's hook and the fake's emulation share: when a
 * run's Bash calls are parked. Plan (ticket 84) and Bypass (ticket 85) bring
 * their own rules, so they are not here.
 */
describe('bashNeedsApproval', () => {
  it('gates Bash in Ask and Accept edits', () => {
    expect(bashNeedsApproval('default')).toBe(true);
    expect(bashNeedsApproval('acceptEdits')).toBe(true);
  });

  it('leaves Plan, Bypass and the refused modes ungated', () => {
    expect(bashNeedsApproval('plan')).toBe(false);
    expect(bashNeedsApproval('bypassPermissions')).toBe(false);
    expect(bashNeedsApproval('dontAsk')).toBe(false);
    expect(bashNeedsApproval('auto')).toBe(false);
  });
});
