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
 * `GET /healthz`'s body. `status` is **first** on the wire on purpose: the setup
 * and deploy scripts match the response with `grep -q '"status":"ok"'`, so a
 * reordered payload would read as a dead server.
 */
export interface HealthResponse {
  status: 'ok';
  build: BuildStamp;
}
