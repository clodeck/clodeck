import type { Project } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

import { isValidName } from './files/reducer';

/**
 * The switcher's data state. `loading` is a state of its own — distinct from
 * `ready` with an empty list — so the UI never flashes "no projects" while the
 * request is still in flight.
 */
export type ProjectsState =
  | { status: 'loading' }
  | { status: 'ready'; projects: Project[] }
  | { status: 'error'; message: string };

export interface ProjectsQuery {
  state: ProjectsState;
  reload: () => void;
  /**
   * Create one project directory under the projects root, and answer it.
   *
   * A refusal **rejects** rather than becoming an error state: the one caller is
   * a dialog that stays open and shows the message, exactly as the drawer's
   * rename does — and a failed create says nothing about the list, which is
   * still whatever it was.
   */
  create: (name: string) => Promise<Project>;
}

/**
 * Fetches `/api/projects` on mount and on every `reload()`, and creates one
 * project on `create()`. The list is re-scanned per request on the server, so a
 * `reload()` after a create is all it takes for the new row to be there.
 */
export function useProjects(): ProjectsQuery {
  const [state, setState] = useState<ProjectsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetchProjects(controller.signal).then(
      (projects) => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', projects });
        }
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

  return {
    state,
    reload: useCallback(() => setAttempt((count) => count + 1), []),
    create: useCallback(createProject, []),
  };
}

/** `GET /api/projects` answers `{ projects: Project[] }` (wayfinder 05 §6). */
async function fetchProjects(signal: AbortSignal): Promise<Project[]> {
  const response = await fetch('/api/projects', { signal, headers: { accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`${String(response.status)} ${response.statusText}`.trim());
  }

  const body: unknown = await response.json();
  if (!isProjectsEnvelope(body)) {
    throw new Error('unexpected response shape');
  }

  return body.projects;
}

/**
 * The contract is compile-time; the wire is not. One guard at the boundary
 * turns a drifted response into the error state instead of a broken render.
 */
function isProjectsEnvelope(body: unknown): body is { projects: Project[] } {
  if (typeof body !== 'object' || body === null) return false;
  const projects = (body as { projects?: unknown }).projects;
  return Array.isArray(projects) && projects.every(isProject);
}

function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof Project, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string'
  );
}

/**
 * `POST /api/projects` — create one directory under the projects root (ticket
 * 47). The write is `mkdir` on the server's disk and nothing else: no template,
 * no initial content, no registry. The answer is the created `Project` — the
 * same shape the list holds — so the caller can select it by id without holding
 * a second copy of it.
 *
 * A refusal (a name that is not one clean segment, a name already taken, no
 * projects root) is the server's to explain, so its `{ error }` is what the
 * caller shows.
 */
async function createProject(name: string): Promise<Project> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isProjectEnvelope(body)) throw new Error('unexpected response shape');
  return body.project;
}

/**
 * Whether a name is safe to offer as a new project: the drawer's own rule — one
 * clean segment — plus discovery's, which is not a *name* rule at all: the scan
 * skips dot-directories, so a `.foo` project would be a directory the user could
 * create and then never see. Re-used from `isValidName` rather than restated, so
 * the two refusals stay one rule and one addition.
 */
export function isValidProjectName(name: string): boolean {
  return isValidName(name) && !name.startsWith('.');
}

/**
 * The server's REST error shape is `{ error }`; a non-JSON body falls back to
 * the status line. The same idiom as `files/transport.ts` and `useSessions.ts`.
 */
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

/** `POST /projects` answers `{ project: Project }`, like `GET` answers `{ projects }`. */
function isProjectEnvelope(body: unknown): body is { project: Project } {
  if (typeof body !== 'object' || body === null) return false;
  return isProject((body as { project?: unknown }).project);
}
