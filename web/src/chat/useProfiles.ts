import type { ProviderProfileSummary } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * What the picker may offer in one project: the profile list, and whether that
 * project pins its provider.
 *
 * The list comes from the server rather than from a constant in this package, so
 * adding a profile is an environment change on the server and not a rebuild of
 * the client (spec-08 §"The picker"), and it is fetched per project because the
 * *pin* is the project's: the same list can be offered whole in one project and
 * trimmed to its tiers in the next. It is a name, a model and a shape per entry
 * and nothing else: the endpoint and the credential never leave the server, so
 * there is nothing here for a browser to leak.
 */
export type ProfilesState =
  | { status: 'loading' }
  | {
      status: 'ready';
      profiles: ProviderProfileSummary[];
      /** True when this project's `.claude/settings.json` pins its provider (ADR 0002). */
      pinned: boolean;
      /** The endpoint the pin declares, when the file declares one. Never the credential. */
      endpoint?: string;
    }
  | { status: 'error'; message: string };

export interface ProfilesQuery {
  state: ProfilesState;
  reload: () => void;
}

export function useProfiles(projectId: string): ProfilesQuery {
  const [state, setState] = useState<ProfilesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchProfiles(projectId, controller.signal).then(
      (offered) => {
        if (!controller.signal.aborted) setState({ status: 'ready', ...offered });
      },
      (error: unknown) => {
        // An aborted request is this effect being replaced, not a failure.
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      },
    );

    return () => controller.abort();
  }, [projectId, attempt]);

  return { state, reload: useCallback(() => setAttempt((count) => count + 1), []) };
}

/** `GET /api/projects/:id/profiles` answers `{ profiles, pinned, endpoint? }`. */
async function fetchProfiles(projectId: string, signal: AbortSignal): Promise<Offered> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/profiles`, {
    signal,
    headers: { accept: 'application/json' },
  });

  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isProfilesEnvelope(body)) throw new Error('unexpected response shape');

  return body;
}

/** Everything the ready state holds but the status itself — the route's whole payload. */
interface Offered {
  profiles: ProviderProfileSummary[];
  pinned: boolean;
  endpoint?: string;
}

/** The server's REST error shape is `{ error }` (the same idiom as `useSessions.ts`). */
async function failureMessage(response: Response): Promise<string> {
  const status = `${String(response.status)} ${response.statusText}`.trim();
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === 'string') return `${status}: ${error}`;
    }
  } catch {
    // A non-JSON body falls back to the status line.
  }
  return status;
}

/**
 * The contract is compile-time; the wire is not. One guard at the boundary turns
 * a drifted response into the error state instead of a broken render.
 */
function isProfilesEnvelope(body: unknown): body is Offered {
  if (typeof body !== 'object' || body === null) return false;
  const profiles = (body as { profiles?: unknown }).profiles;
  const pinned = (body as { pinned?: unknown }).pinned;
  const endpoint = (body as { endpoint?: unknown }).endpoint;
  return (
    Array.isArray(profiles) &&
    profiles.every(isProfileSummary) &&
    typeof pinned === 'boolean' &&
    (endpoint === undefined || typeof endpoint === 'string')
  );
}

function isProfileSummary(value: unknown): value is ProviderProfileSummary {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; model?: unknown; shape?: unknown };
  return (
    typeof candidate.name === 'string' &&
    (candidate.model === undefined || typeof candidate.model === 'string') &&
    (candidate.shape === 'provider' || candidate.shape === 'tier')
  );
}
