import type { ProviderProfileSummary } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * The profile list the picker offers, shaped like `useProjects`: a discriminated
 * state union and an effect that owns the request.
 *
 * The list comes from the server rather than from a constant in this package, so
 * adding a profile is an environment change on the server and not a rebuild of
 * the client (spec-08 §"The picker"). It is a name and a model per entry and
 * nothing else: the endpoint and the credential never leave the server, so there
 * is nothing here for a browser to leak.
 */
export type ProfilesState =
  | { status: 'loading' }
  | { status: 'ready'; profiles: ProviderProfileSummary[] }
  | { status: 'error'; message: string };

export interface ProfilesQuery {
  state: ProfilesState;
  reload: () => void;
}

export function useProfiles(): ProfilesQuery {
  const [state, setState] = useState<ProfilesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchProfiles(controller.signal).then(
      (profiles) => {
        if (!controller.signal.aborted) setState({ status: 'ready', profiles });
      },
      (error: unknown) => {
        // An aborted request is this effect being replaced, not a failure.
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      },
    );

    return () => controller.abort();
  }, [attempt]);

  return { state, reload: useCallback(() => setAttempt((count) => count + 1), []) };
}

/** `GET /api/profiles` answers `{ profiles: ProviderProfileSummary[] }`. */
async function fetchProfiles(signal: AbortSignal): Promise<ProviderProfileSummary[]> {
  const response = await fetch('/api/profiles', { signal, headers: { accept: 'application/json' } });

  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isProfilesEnvelope(body)) throw new Error('unexpected response shape');

  return body.profiles;
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
function isProfilesEnvelope(body: unknown): body is { profiles: ProviderProfileSummary[] } {
  if (typeof body !== 'object' || body === null) return false;
  const profiles = (body as { profiles?: unknown }).profiles;
  return Array.isArray(profiles) && profiles.every(isProfileSummary);
}

function isProfileSummary(value: unknown): value is ProviderProfileSummary {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; model?: unknown };
  return typeof candidate.name === 'string' && (candidate.model === undefined || typeof candidate.model === 'string');
}
