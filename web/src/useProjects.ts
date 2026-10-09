import type { Project } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

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
}

/** Fetches `/api/projects` on mount and on every `reload()`. */
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

  return { state, reload: useCallback(() => setAttempt((count) => count + 1), []) };
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
