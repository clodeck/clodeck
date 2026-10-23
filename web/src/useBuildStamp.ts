import { isBuildStamp, UNKNOWN_BUILD_STAMP, type BuildStamp, type HealthResponse } from '@clodeck/shared';
import { useEffect, useState } from 'react';

/**
 * The running build, read once per page load from `/healthz` (ticket 94).
 *
 * The fetch happens here rather than in the two surfaces that draw the line —
 * the login screen and the sidebar header — because the server's answer is
 * about the process, not about a session: one request serves whichever surface
 * is mounted, and a login only swaps which one that is. `/healthz` is
 * auth-exempt, so this runs before anybody has signed in.
 *
 * Nothing is invented on failure. A server that cannot be reached, or a body
 * that is not the contract, answers `unknown`: the line is still drawn, and it
 * says the one thing that is true — this page cannot tell which build is
 * running.
 */
export function useBuildStamp(): BuildStamp | null {
  const [build, setBuild] = useState<BuildStamp | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchBuildStamp(controller.signal).then(
      (stamp) => {
        if (!controller.signal.aborted) setBuild(stamp);
      },
      () => {
        // An aborted request is this effect being replaced, not a failure.
        if (!controller.signal.aborted) setBuild(UNKNOWN_BUILD_STAMP);
      },
    );

    return () => controller.abort();
  }, []);

  return build;
}

/** `GET /healthz` — public, uncached, and the only source of the stamp. */
async function fetchBuildStamp(signal: AbortSignal): Promise<BuildStamp> {
  const response = await fetch('/healthz', {
    signal,
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`.trim());

  const body: unknown = await response.json();
  if (!isHealthResponse(body)) throw new Error('unexpected response shape');
  return body.build;
}

/**
 * The contract is compile-time; the wire is not. `/healthz` also answers the
 * Docker and Caddy healthchecks, so a proxy's own page or an older server's
 * `{"status":"ok"}` must read as `unknown` rather than as a build.
 */
function isHealthResponse(body: unknown): body is HealthResponse {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as { status?: unknown; build?: unknown };
  return candidate.status === 'ok' && isBuildStamp(candidate.build);
}
