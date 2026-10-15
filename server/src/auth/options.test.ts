import { describe, expect, it } from 'vitest';

import { createTestApp, setCookieHeader } from '../test-support.js';
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
    const auth = await createAuthOptions(null, null, (message) => warnings.push(message));

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

  it('carries the declared public origin through to the session cookie', async () => {
    // The one hop configuration makes to reach the browser's rule: `main.ts`
    // and `dev:fake` hand this builder the deployment's two facts, and the seam
    // it returns is what the transport reads.
    const auth = await createAuthOptions('correct horse battery staple', 'http://203.0.113.10:3001');
    const app = createTestApp({ auth });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'correct horse battery staple' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(setCookieHeader(response)).not.toContain('Secure');
  });
});
