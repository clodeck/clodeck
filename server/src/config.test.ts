import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig, permissionModeFromEnv } from './config.js';

/**
 * The deployment's default permission mode (ticket 82).
 *
 * The three values the contract offers are accepted; everything else stops the
 * boot. That is deliberately harsher than the loader's other variables: a mode
 * nobody chose would run every turn under a policy the UI does not name, and a
 * warning beside it would be the only trace.
 */
describe('CLODECK_PERMISSION_MODE', () => {
  it('is Ask when nothing is declared, and when the variable is blank', () => {
    expect(permissionModeFromEnv({})).toBe('default');
    // `config.ts`'s one definition of unset: an exported-but-empty variable is
    // a shell accident, not a mode.
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: '   ' })).toBe('default');
  });

  it('accepts the three modes this ticket offers', () => {
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'default' })).toBe('default');
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'acceptEdits' })).toBe('acceptEdits');
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'plan' })).toBe('plan');
  });

  it('refuses Bypass until its gates land, and says so', () => {
    expect(() => permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'bypassPermissions' })).toThrow(
      /Bypass is not available yet.*ticket 85/,
    );
  });

  it('names the value it was given and the modes it accepts', () => {
    expect(() => permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'yolo' })).toThrow(
      'CLODECK_PERMISSION_MODE is "yolo"; use one of default, acceptEdits, plan',
    );
  });

  it('refuses the two modes the wire refuses for good', () => {
    for (const mode of ['auto', 'dontAsk']) {
      expect(() => permissionModeFromEnv({ CLODECK_PERMISSION_MODE: mode })).toThrow(
        'CLODECK_PERMISSION_MODE',
      );
    }
  });

  it('is what the boot config carries', () => {
    const config = loadConfig({
      env: { CLODECK_PERMISSION_MODE: 'plan' },
      configPath: path.join(tmpdir(), 'clodeck-absent.config.json'),
      cwd: tmpdir(),
      warn: () => undefined,
    });

    expect(config.permissionMode).toBe('plan');
  });
});
