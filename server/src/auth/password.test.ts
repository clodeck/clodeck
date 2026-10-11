import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

/**
 * The real scrypt, exercised directly — the one unit-test exception in the auth
 * slice (spec-05 §Testing): every route suite injects a trivial `verifyPassword`
 * instead, because scrypt is deliberately slow. What this file pins is the
 * storage contract (`scrypt$N$r$p$salt$hash`) and the round trip through it.
 */
describe('password hashing', () => {
  it('round-trips a password through its own hash', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('correct horse battery stapl', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
    await expect(verifyPassword('CORRECT HORSE BATTERY STAPLE', hash)).resolves.toBe(false);
  });

  it('salts every hash, so one password is never one string', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');

    // Different salt and different digest, but both verify: the salt, not the
    // password, is what makes the two strings differ.
    expect(first).not.toBe(second);
    await expect(verifyPassword('same password', first)).resolves.toBe(true);
    await expect(verifyPassword('same password', second)).resolves.toBe(true);

    const saltOf = (hash: string) => hash.split('$')[4];
    expect(saltOf(first)).not.toBe(saltOf(second));
    // A 16-byte salt, base64 — the one storage detail a reader can check.
    expect(Buffer.from(saltOf(first) ?? '', 'base64')).toHaveLength(16);
  });

  it('stores the parameters it derived with, self-described', async () => {
    const hash = await hashPassword('whatever');

    // The pinned params (spec-05 §Password): N=16384, r=8, p=1.
    const [algorithm, n, r, p, salt, key] = hash.split('$');
    expect([algorithm, n, r, p]).toEqual(['scrypt', '16384', '8', '1']);
    expect(Buffer.from(salt ?? '', 'base64')).toHaveLength(16);
    expect(Buffer.from(key ?? '', 'base64')).toHaveLength(32);
  });

  it('verifies against a stored hash rather than a freshly derived one', async () => {
    // The hash is written, read back as an opaque string, and only then used —
    // which is the real life of this value (an env var, a config file).
    const stored = await hashPassword('let me in');
    const reread = String(stored);

    await expect(verifyPassword('let me in', reread)).resolves.toBe(true);
  });

  it('answers false for a hash it cannot parse, instead of throwing', async () => {
    const malformed = [
      '',
      'not-a-hash',
      'scrypt$16384$8$1$only-five-parts',
      // An unknown algorithm must not be run through scrypt's parser.
      'bcrypt$16384$8$1$c2FsdA==$a2V5',
      // Non-numeric or zero params.
      'scrypt$nope$8$1$c2FsdA==$a2V5',
      'scrypt$0$8$1$c2FsdA==$a2V5',
      // A salt/key that is not base64.
      'scrypt$16384$8$1$!!!$a2V5',
      'scrypt$16384$8$1$c2FsdA==$',
    ];

    for (const hash of malformed) {
      await expect(verifyPassword('anything', hash), hash).resolves.toBe(false);
    }
  });

  it('answers false when the stored key is the wrong length', async () => {
    // `timingSafeEqual` throws on a length mismatch, so this arm is a guard
    // rather than a comparison: a corrupted (or truncated) digest is a no.
    const hash = await hashPassword('a password');
    const [algorithm, n, r, p, salt] = hash.split('$');
    const truncated = [algorithm, n, r, p, salt, Buffer.from([1, 2, 3]).toString('base64')].join('$');

    await expect(verifyPassword('a password', truncated)).resolves.toBe(false);
  });
});
