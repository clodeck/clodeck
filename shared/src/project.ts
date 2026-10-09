/**
 * One project = one directory the server hosts: the cwd of its Agent SDK
 * sessions and its terminal, and the unit the project switcher lists.
 */
export type Project = {
  /**
   * Reversible `base64url` of the canonical absolute path — a stable identifier,
   * not a credential: the server re-validates the allowlist on every request
   * rather than trusting a decoded id (wayfinder 05 §7).
   */
  id: string;
  /** The directory's basename; what the user sees. */
  name: string;
  /** The canonical absolute path. Display-only convenience for the single user. */
  path: string;
};
