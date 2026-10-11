/**
 * `@clodeck/shared` — the contract package.
 *
 * Both `server` and `web` import this, so a shape is defined once and cannot
 * drift between backend and frontend: a contract change breaks compilation on
 * both sides at the same time.
 *
 * - {@link Project} — the domain entity the switcher lists.
 * - `protocol.ts` — the ServerEvent / ClientMessage envelopes.
 * - `sdk.ts` — structural mirrors of the Agent SDK messages the client renders
 *   (no dependency on the SDK itself; that stays server-only).
 * - `session.ts` — the session-history shapes the two REST endpoints serve.
 * - `files.ts` — the file-drawer shapes the file-viewer endpoints serve.
 * - `auth.ts` — the `Principal` an authenticated session resolves to.
 *
 * The envelope and SDK types are declared here ahead of the transport that
 * carries them, so the chat slice never re-models them.
 */
export * from './auth.js';
export * from './files.js';
export * from './project.js';
export * from './protocol.js';
export * from './sdk.js';
export * from './session.js';
