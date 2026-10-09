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
 *
 * The envelope and SDK types are declared here ahead of the transport that
 * carries them, so the chat slice never re-models them.
 */
export * from './project.js';
export * from './protocol.js';
export * from './sdk.js';
