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

/**
 * What a profile declares, by the two words decision 9 keeps it to: a
 * **provider** names the endpoint or the credential, so the model it carries
 * belongs to that host; a **tier** names only a model, and can run on any of
 * them. The reserved default declares nothing, which makes it a tier — *whatever
 * this server has* is a model to a project that pins its own endpoint.
 *
 * A pinned project offers **only tiers**, because a vendor's model name means
 * nothing at another vendor's endpoint. It is classified by what a profile
 * *declares* rather than by what it resolves to: a tier inherits the server's
 * endpoint all the same, and declaring an endpoint of one's own is exactly the
 * claim this word is about.
 */
export type ProviderProfileShape = 'provider' | 'tier';

/**
 * One profile as the picker is told about it: a name to choose by, the model
 * that name resolves to, and the shape that decides where it may be offered —
 * never the endpoint, and never the credential
 * (`.scratch/clodeck/issues/66-provider-profiles-decision.md`, decision 14).
 *
 * A list of these is the whole of what the client receives, which is why it is a
 * type of its own rather than a settled {@link ResolvedProvider}: the two shapes
 * differ in exactly the field that must not cross the wire, so a route that
 * served the wrong one cannot compile.
 */
export interface ProviderProfileSummary {
  /** The name to choose by: `default`, or the operator's normalized name. */
  name: string;
  /** The model this profile resolves to. Absent means the endpoint decides. */
  model?: string;
  /** Whether this profile may be offered to a project that pins its provider. */
  shape: ProviderProfileShape;
}

/**
 * The reserved profile: "whatever this server already has". What it resolves to
 * is the server's own environment, so a deployment that declares no profile of
 * its own runs exactly as it did before profiles existed — and a declaration
 * that clashes with the name (case-insensitively) is refused.
 *
 * It is here, beside the shapes it is part of, because **both** ends write it: a
 * session opens on it when the browser remembers no other choice, and the server
 * resolves a wire name by exact match — so one copy per package would be two
 * literals that have to agree, with no compiler between them to say when they
 * stop.
 */
export const DEFAULT_PROFILE = 'default';
