# 23: Auth foundations — Principal, scrypt password, session store

**What to build:** The two testable auth foundations plus the shared `Principal` type — no route, no gate yet. `hashPassword`/`verifyPassword` hold the single password only as a salted **Node `crypto.scrypt`** hash and compare timing-safe; `SessionStore` is the in-memory, server-side store behind the cookie (sliding 7-day idle, injectable clock). These are the seams the transport (24) and the install (25) hang off.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `shared/src/auth.ts` declares `Principal = { id: string; name: string }`, re-exported from `shared/src/index.ts`.
- [ ] `server/src/auth/password.ts` exports `hashPassword(plaintext)` and `verifyPassword(plaintext, hash)`: a per-password random 16-byte salt, `crypto.scrypt` with `N=16384, r=8, p=1`, a self-describing `scrypt$N$r$p$<salt>$<hash>` storage string, and a `crypto.timingSafeEqual` comparison over the derived key (never a string compare).
- [ ] `server/src/auth/sessions.ts` declares `Session` (`{ id; principal; expiresAt }`), the `SessionStore` interface (`get`/`create`/`destroy`), and `createSessionStore({ idleMs = 7d, now = Date.now })`: `get` slides the idle window on hit and drops an expired entry on read; the session id is `crypto.randomBytes(32).toString('base64url')` (opaque CSPRNG token, no signing).
- [ ] No route, no `buildApp` change, no `@fastify/cookie` dependency yet — foundations only.
- [ ] Unit tests: scrypt round-trip + wrong-password `false` + salt uniqueness; store `create`/`get`/`destroy`, sliding idle, and expiry — all driven through an injected `now` clock.
