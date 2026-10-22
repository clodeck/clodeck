import { describe, expect, it } from 'vitest';

import { BYPASS_OFF_BY_PROJECT, BYPASS_OFF_BY_SERVER, bypassAvailability } from './bypass.js';

/**
 * The two gates around **Bypass** (ticket 85), as the one answer a snapshot can
 * carry. The reason matters as much as the answer: the chip shows it, and a
 * refusal nobody can read is a chip that went missing.
 */
describe('bypassAvailability', () => {
  it('allows the mode when neither gate refuses it', () => {
    expect(bypassAvailability(true, false)).toEqual({ allowed: true });
  });

  it('refuses it when the deployment switched it off, and names that gate', () => {
    expect(bypassAvailability(false, false)).toEqual({
      allowed: false,
      reason: BYPASS_OFF_BY_SERVER,
    });
  });

  it('refuses it when the project’s own settings do', () => {
    expect(bypassAvailability(true, true)).toEqual({
      allowed: false,
      reason: BYPASS_OFF_BY_PROJECT,
    });
  });

  it('names the deployment when both say no', () => {
    // The half the user cannot change from the drawer is the one worth naming.
    expect(bypassAvailability(false, true)).toEqual({
      allowed: false,
      reason: BYPASS_OFF_BY_SERVER,
    });
  });
});
