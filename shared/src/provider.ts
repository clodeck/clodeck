/**
 * The provider a run executes on
 * (`docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`).
 *
 * A **provider profile** is a patch over the server's environment, and resolving
 * one fills in what it inherits, so the value that reaches a run is always a
 * resolved whole rather than a patch: the endpoint the run's requests go to, the
 * credential they carry, and the model they ask for. This is that whole.
 *
 * It is a shared type, not an SDK shape: the server owns the translation into
 * the Agent SDK's own variables, and the client is told a profile's name and
 * model — never its credential, and no endpoint it cannot already read for
 * itself.
 *
 * Every field is optional because *every* field can be inherited from a server
 * that does not export it. An absent model is not a missing value to be filled
 * in later but the endpoint's own decision
 * (`.scratch/clodeck/issues/66-provider-profiles-decision.md`, decision 13).
 */
export interface ResolvedProvider {
  /** The Anthropic-compatible endpoint this run's requests go to. */
  baseUrl?: string;
  /** The credential those requests carry. */
  authToken?: string;
  /** The model this run asks for. Absent means the endpoint decides. */
  model?: string;
}
