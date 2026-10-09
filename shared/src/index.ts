/**
 * @clodeck/shared — the contract package.
 *
 * Both `server` and `web` import this, so a shape is defined once and cannot
 * drift between backend and frontend. Ticket 02 lands the domain types here
 * (`Project`, the `ServerEvent` / `ClientMessage` envelopes, and the structural
 * `SDKMessage` mirror).
 *
 * For now the package holds only what proves the wiring is real rather than
 * theoretical: build, declaration emit, and cross-package import.
 */

/** Wire-format version stamped on every envelope the client and server exchange. */
export const PROTOCOL_VERSION = 1;
