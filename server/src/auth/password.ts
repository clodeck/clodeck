import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The password at rest (spec-05 §Password): one salted scrypt hash, derived and
 * compared by Node's own `crypto` — no native dependency, which matters because
 * node-pty is already one native binding and the image must stay glibc-only.
 *
 * The storage string is self-describing — `scrypt$N$r$p$<salt>$<hash>` — so a
 * parameter change is a change *inside the value*, not a migration: an old hash
 * keeps verifying with the params it was written with.
 *
 * These two functions are the whole surface. `hashPassword` runs once at boot;
 * `verifyPassword` runs once per login attempt.
 */

/** The derived-key length, in bytes. */
const KEY_BYTES = 32;

/** A per-password salt: 16 random bytes, never reused, never derived. */
const SALT_BYTES = 16;

/** scrypt's three work factors, as one shape: they are only ever used together. */
interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * The pinned work factors (spec-05 §Password). Memory-hard: N=16384, r=8 costs
 * 128·N·r ≈ 16 MiB per derivation.
 */
const PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

/**
 * scrypt's default cap is 32 MiB, which N=16384/r=8 sits just under; the
 * explicit headroom keeps the value from being the reason a future bump fails.
 */
const MAX_MEM = 64 * 1024 * 1024;

const ALGORITHM = 'scrypt';
const SEPARATOR = '$';

/** Hash a plaintext password: a fresh salt, the pinned params, a new string. */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plaintext, salt, PARAMS);

  return [
    ALGORITHM,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join(SEPARATOR);
}

/**
 * Verify a plaintext against a stored hash. An unparsable hash is `false`, never
 * a throw: the value arrives from configuration, and a typo in it must be a
 * failed login rather than a 500.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  const stored = parseHash(hash);
  if (stored === null) return false;

  const key = await derive(plaintext, stored.salt, stored.params);
  // `timingSafeEqual` throws on different lengths, so a corrupted digest is a
  // guarded `false` — the length is not the secret.
  if (key.length !== stored.key.length) return false;

  return timingSafeEqual(key, stored.key);
}

interface StoredHash {
  salt: Buffer;
  key: Buffer;
  params: ScryptParams;
}

/**
 * Read a storage string back into its parts, or `null` when it is not one. Only
 * the algorithm this module writes is accepted, and only a non-empty salt/key
 * of honest base64: everything else is "not a hash we can check".
 */
function parseHash(hash: string): StoredHash | null {
  const parts = hash.split(SEPARATOR);
  if (parts.length !== 6) return null;

  const [algorithm, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  if (algorithm !== ALGORITHM) return null;
  if (rawN === undefined || rawR === undefined || rawP === undefined) return null;
  if (rawSalt === undefined || rawKey === undefined) return null;

  const N = readParam(rawN);
  const r = readParam(rawR);
  const p = readParam(rawP);
  if (N === null || r === null || p === null) return null;

  const salt = readBase64(rawSalt);
  const key = readBase64(rawKey);
  if (salt === null || key === null) return null;
  if (salt.length === 0 || key.length === 0) return null;

  return { salt, key, params: { N, r, p } };
}

/** A scrypt parameter: a positive integer, or `null`. */
function readParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Base64 back to bytes, or `null`. `Buffer.from` is lenient enough to decode
 * most garbage, so the re-encode has to round-trip before the value is trusted.
 */
function readBase64(raw: string): Buffer | null {
  if (raw === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const decoded = Buffer.from(raw, 'base64');
  return decoded.toString('base64') === raw ? decoded : null;
}

/** `crypto.scrypt` as a promise — the callback form, without promisify's overload guessing. */
function derive(plaintext: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plaintext, salt, KEY_BYTES, { ...params, maxmem: MAX_MEM }, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}
