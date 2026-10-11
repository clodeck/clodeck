# 23: Auth foundations — Principal, scrypt password, session store

**What to build:** The two testable auth foundations plus the shared `Principal` type — no route, no gate yet. `hashPassword`/`verifyPassword` hold the single password only as a salted **Node `crypto.scrypt`** hash and compare timing-safe; `SessionStore` is the in-memory, server-side store behind the cookie (sliding 7-day idle, injectable clock). These are the seams the transport (24) and the install (25) hang off.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `shared/src/auth.ts` declares `Principal = { id: string; name: string }`, re-exported from `shared/src/index.ts`.
- [x] `server/src/auth/password.ts` exports `hashPassword(plaintext)` and `verifyPassword(plaintext, hash)`: a per-password random 16-byte salt, `crypto.scrypt` with `N=16384, r=8, p=1`, a self-describing `scrypt$N$r$p$<salt>$<hash>` storage string, and a `crypto.timingSafeEqual` comparison over the derived key (never a string compare).
- [x] `server/src/auth/sessions.ts` declares `Session` (`{ id; principal; expiresAt }`), the `SessionStore` interface (`get`/`create`/`destroy`), and `createSessionStore({ idleMs = 7d, now = Date.now })`: `get` slides the idle window on hit and drops an expired entry on read; the session id is `crypto.randomBytes(32).toString('base64url')` (opaque CSPRNG token, no signing).
- [x] No route, no `buildApp` change, no `@fastify/cookie` dependency yet — foundations only.
- [x] Unit tests: scrypt round-trip + wrong-password `false` + salt uniqueness; store `create`/`get`/`destroy`, sliding idle, and expiry — all driven through an injected `now` clock.

## What landed

```
shared/src/auth.ts            Principal, re-exported from shared/src/index.ts (+ an index.test.ts shape assertion).
server/src/auth/password.ts   hashPassword / verifyPassword; parseHash + readParam/readBase64 guards; scrypt as a
                              promise wrapper (no promisify).
server/src/auth/sessions.ts   Session, SessionStore, createSessionStore, DEFAULT_IDLE_MS.
server/src/auth/password.test.ts   7 tests — round trip, wrong password, per-hash salt, stored params, reread hash,
                                   unparsable hashes, wrong-length key.
server/src/auth/sessions.test.ts   9 tests — create/expiry, opaque token, unique ids, 7-day default, unknown token,
                                   sliding window, dropped-not-filtered, destroy, independence.
```

## Decisions the spec did not pin

- **The derived key is 32 bytes** (`KEY_BYTES`), not scrypt's 64-byte default. Nothing else depends on it: the
  length rides in the storage string, and a mismatch against a stored digest is a guarded `false`.
- **`parseHash` is strict** — six parts, `scrypt` only, positive-integer params, and base64 that re-encodes to
  itself (Node's `Buffer.from` is lenient enough to decode most garbage). A malformed hash is `false`, never a
  throw: the value comes from configuration, so a typo there must be a failed login, not a 500.
- **`maxmem` is set explicitly** (64 MiB) rather than left at scrypt's 32 MiB default, which `N=16384, r=8` sits
  uncomfortably close to.
- **An expired entry is deleted on read**, not filtered — so a clock that moves backwards cannot resurrect a
  session that already lapsed. The test pins exactly that.
- **`get` returns the live `Session`** (mutating `expiresAt` on hit) rather than a copy: the sliding window *is*
  the store's state, and the caller only ever reads the principal from it.

## Code review

Two-axis review of the slice (Standards vs the repo's documented conventions + the Fowler smell baseline; Spec vs
`spec-05-auth.md` and tickets 23–26). This ticket's files came back clean; one judgement call was actioned:

- **Fixed — Data Clump** (Standards): the scrypt work-factor shape `{ N; r; p }` was spelled out three times in
  `password.ts` (the pinned constant, `StoredHash.params`, `derive`'s parameter). It now has one name,
  `ScryptParams`, used in all three places.

## Evidence

```
npx vitest run src/auth/            → 16 passed (password 7, sessions 9)
npm run typecheck                   → clean (shared → server → web)
```
