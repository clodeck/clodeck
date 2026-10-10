import { describe, expect, it } from 'vitest';

import { platformShell, terminalEnv } from './platform-shell.js';

/**
 * The two decisions the real spawner makes before it hands node-pty a command
 * line — which shell, and with what environment. Both are pure, so they are
 * tested here without importing node-pty and without forking anything; the
 * spawn call itself is the spec's manual-only path.
 */

describe('platformShell', () => {
  it('uses powershell.exe on Windows', () => {
    expect(platformShell('win32', '/bin/zsh')).toBe('powershell.exe');
  });

  it('uses $SHELL on POSIX when it is set', () => {
    expect(platformShell('linux', '/bin/zsh')).toBe('/bin/zsh');
    expect(platformShell('darwin', '/usr/local/bin/fish')).toBe('/usr/local/bin/fish');
  });

  it('falls back to bash on POSIX when $SHELL is unset', () => {
    expect(platformShell('linux', undefined)).toBe('bash');
    expect(platformShell('linux', '')).toBe('bash');
  });
});

describe('terminalEnv', () => {
  it('carries the parent environment through', () => {
    const env = terminalEnv({ PATH: '/usr/bin', HOME: '/home/me' });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/me');
  });

  it('advertises a 256-colour terminal, overriding whatever was inherited', () => {
    const env = terminalEnv({ TERM: 'dumb', COLORTERM: 'false' });

    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('drops variables that are present but unset', () => {
    const env = terminalEnv({ PRESENT: 'yes', MISSING: undefined });

    expect(env.PRESENT).toBe('yes');
    // node-pty wants a `Record<string, string>`, so no `undefined` may survive.
    expect(Object.keys(env)).not.toContain('MISSING');
  });
});
