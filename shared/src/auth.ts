/**
 * Auth contracts (spec-05): the principal a session resolves to.
 *
 * There is exactly one principal in this slice — `{ id: 'default', name:
 * 'default' }` — and the boundary is binary (authenticated or not). The type
 * exists now because it is the *seam*: multi-user scoping is "parameterize with
 * an actor", and that act needs a name for the actor that both the server and
 * the client already agree on.
 *
 * It is a REST shape, not a `/ws` envelope kind, so `protocol.ts` stays
 * untouched — the same posture as `session.ts` and `files.ts` beside it.
 */

/** Who a session belongs to. One value today; the attach-point for more. */
export interface Principal {
  id: string;
  name: string;
}
