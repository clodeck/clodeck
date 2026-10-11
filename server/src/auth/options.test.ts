import { describe, expect, it } from 'vitest';

import { createAuthOptions } from './options.js';

/**
 * The seam building — the one place production decides *what* verifies a login.
 * It is tested directly because its two arms are the slice's security posture:
 * a configured password is a scrypt hash, and an unconfigured one is a
 * credential nothing can satisfy.
 */
describe('building the production auth seam', () => {
  it('verifies against the scrypt hash of the configured password', async () => {
    const auth = await createAuthOptions('correct horse battery staple');

    await expect(auth.verifyPassword('correct horse battery staple')).resolves.toBe(true);
    await expect(auth.verifyPassword('wrong')).resolves.toBe(false);
  });

  it('fails closed — and says so — when no password is configured', async () => {
    const warnings: string[] = [];
    const auth = await createAuthOptions(null, (message) => warnings.push(message));

    // No value satisfies it, so no login can ever succeed. The server still
    // boots: the failure is a 401, not a crash.
    await expect(auth.verifyPassword('')).resolves.toBe(false);
    await expect(auth.verifyPassword('anything at all')).resolves.toBe(false);
    expect(warnings.join('\n')).toContain('UI_PASSWORD');
  });

  it('gives each app its own session store', async () => {
    const first = await createAuthOptions('a password');
    const second = await createAuthOptions('a password');

    const session = first.sessions.create({ id: 'default', name: 'default' });

    expect(first.sessions.get(session.id)).toBeDefined();
    expect(second.sessions.get(session.id)).toBeUndefined();
  });
});
