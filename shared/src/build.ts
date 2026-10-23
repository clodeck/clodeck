/**
 * The build that is running, and the one place the answer is modelled.
 *
 * `npm run build` bakes it into the server artifact, the server reads it once at
 * boot and serves it at `/healthz`, and the client shows the same line on the
 * login screen and in the sidebar (ADR 0004). It describes the **artifact**, not
 * the checkout beside it: a `git pull` with no rebuild must not change what the
 * running process says.
 */
export interface BuildStamp {
  /**
   * The full 40-hex commit the artifact was built from, or `dev` in the dev
   * loop, or `unknown` when there was neither a repository nor a declared
   * `CLODECK_BUILD_COMMIT`. The two words are shown, never hidden: a masked
   * stamp is the lie the feature exists to prevent.
   */
  commit: string;
  /** When the build ran, ISO 8601, or `null` when there was no build (the dev loop). */
  builtAt: string | null;
  /** Whether the working tree had uncommitted changes when the build ran. */
  dirty: boolean;
}

/**
 * What either side answers when it cannot name the running build: the server
 * from a stamp file that is present but unreadable (a build did happen, so this
 * is not the dev loop's `dev`), the client from a `/healthz` it could not read.
 * One constant for both, because "I cannot tell which build this is" means the
 * same thing on either side of the wire.
 */
export const UNKNOWN_BUILD_STAMP: BuildStamp = { commit: 'unknown', builtAt: null, dirty: false };

/**
 * `GET /healthz`'s body. `status` is **first** on the wire on purpose: the setup
 * and deploy scripts match the response with `grep -q '"status":"ok"'`, so a
 * reordered payload would read as a dead server.
 */
export interface HealthResponse {
  status: 'ok';
  build: BuildStamp;
}

/**
 * Whether `value` is a complete stamp. Both ends of the contract check it — the
 * server against a `build-stamp.json` that could have been hand-edited, truncated
 * by a failed copy or written by another version, the client against a `/healthz`
 * that could be a proxy's page or an older server's `{"status":"ok"}` — so the
 * one rule lives here rather than in two copies that could drift.
 */
export function isBuildStamp(value: unknown): value is BuildStamp {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['commit'] === 'string' &&
    candidate['commit'] !== '' &&
    (candidate['builtAt'] === null || typeof candidate['builtAt'] === 'string') &&
    typeof candidate['dirty'] === 'boolean'
  );
}
