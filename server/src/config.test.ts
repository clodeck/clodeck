import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { allowBypassFromEnv, loadConfig, permissionModeFromEnv } from './config.js';

/**
 * The deployment's default permission mode (ticket 82) and the deployment's
 * Bypass gate (ticket 85).
 *
 * The four values the contract offers are accepted — Bypass only on a server
 * that allows it; everything else stops the boot. That is deliberately harsher
 * than the loader's other variables: a mode nobody chose would run every turn
 * under a policy the UI does not name, and a warning beside it would be the only
 * trace.
 */
describe('CLODECK_PERMISSION_MODE', () => {
  it('is Ask when nothing is declared, and when the variable is blank', () => {
    expect(permissionModeFromEnv({}, true)).toBe('default');
    // `config.ts`'s one definition of unset: an exported-but-empty variable is
    // a shell accident, not a mode.
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: '   ' }, true)).toBe('default');
  });

  it('accepts the four modes the contract offers', () => {
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'default' }, true)).toBe('default');
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'acceptEdits' }, true)).toBe(
      'acceptEdits',
    );
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'plan' }, true)).toBe('plan');
    expect(permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'bypassPermissions' }, true)).toBe(
      'bypassPermissions',
    );
  });

  it('refuses Bypass as a default on a server that switched it off', () => {
    // A deployment that bans Bypass and asks for it as its default is a
    // contradiction, and the boot is where it should be found.
    expect(() =>
      permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'bypassPermissions' }, false),
    ).toThrow(/CLODECK_ALLOW_BYPASS is off/);
  });

  it('names the value it was given and the modes it accepts', () => {
    expect(() => permissionModeFromEnv({ CLODECK_PERMISSION_MODE: 'yolo' }, true)).toThrow(
      'CLODECK_PERMISSION_MODE is "yolo"; use one of default, acceptEdits, plan, bypassPermissions',
    );
  });

  it('refuses the two modes the wire refuses for good', () => {
    for (const mode of ['auto', 'dontAsk']) {
      expect(() => permissionModeFromEnv({ CLODECK_PERMISSION_MODE: mode }, true)).toThrow(
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

/**
 * `CLODECK_ALLOW_BYPASS` (ticket 85, decision 10): on unless the operator says
 * otherwise, read the way a shell writes a boolean, and **off** for anything it
 * does not recognise — a gate's failure mode is to stay shut.
 */
describe('CLODECK_ALLOW_BYPASS', () => {
  it('is on when the variable is unset or blank: a single-user server keeps the option', () => {
    expect(allowBypassFromEnv({}, () => undefined)).toBe(true);
    expect(allowBypassFromEnv({ CLODECK_ALLOW_BYPASS: '  ' }, () => undefined)).toBe(true);
  });

  it('reads the words a shell writes', () => {
    for (const off of ['off', 'false', 'no', '0', 'OFF']) {
      expect(allowBypassFromEnv({ CLODECK_ALLOW_BYPASS: off }, () => undefined)).toBe(false);
    }
    for (const on of ['on', 'true', 'yes', '1']) {
      expect(allowBypassFromEnv({ CLODECK_ALLOW_BYPASS: on }, () => undefined)).toBe(true);
    }
  });

  it('stays shut on a value it cannot read, and says so', () => {
    const warnings: string[] = [];
    // A typo must not open the widest mode in the product; the warning is what
    // turns "my bypass does not work" into an answer.
    expect(
      allowBypassFromEnv({ CLODECK_ALLOW_BYPASS: 'enabled' }, (line) => warnings.push(line)),
    ).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('CLODECK_ALLOW_BYPASS is "enabled"');
  });

  it('reaches the boot config', () => {
    const config = loadConfig({
      env: { CLODECK_ALLOW_BYPASS: 'off' },
      configPath: path.join(tmpdir(), 'clodeck-absent.config.json'),
      cwd: tmpdir(),
      warn: () => undefined,
    });

    expect(config.allowBypass).toBe(false);
  });
});
