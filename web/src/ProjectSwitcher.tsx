import type { Project } from '@clodeck/shared';
import type { ReactElement } from 'react';

import type { ProjectsState } from './useProjects';

interface ProjectSwitcherProps {
  state: ProjectsState;
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
}

/**
 * The slice's only interactive surface: the discovered projects, with a
 * refresh affordance and the three states a fetch can leave the UI in.
 */
export function ProjectSwitcher({
  state,
  selectedId,
  onSelect,
  onRefresh,
}: ProjectSwitcherProps): ReactElement {
  const loading = state.status === 'loading';

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Projects" aria-busy={loading}>
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Projects</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink disabled:opacity-40"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <LoadingProjects />}
        {state.status === 'error' && <ErrorProjects message={state.message} onRetry={onRefresh} />}
        {state.status === 'ready' &&
          (state.projects.length === 0 ? (
            <EmptyProjects />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {state.projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(project);
                    }}
                    aria-current={project.id === selectedId}
                    title={project.path}
                    className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                      project.id === selectedId
                        ? 'bg-white/10 text-ink'
                        : 'text-ink-dim hover:bg-white/5 hover:text-ink'
                    }`}
                  >
                    {project.name}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}

function LoadingProjects(): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1" role="status" aria-label="Loading projects">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-6 animate-pulse rounded bg-white/5" />
      ))}
    </div>
  );
}

function ErrorProjects({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div className="m-1 rounded border border-err/40 bg-err/10 p-3" role="alert">
      <p className="text-xs font-semibold text-err">Could not load projects</p>
      <p className="mt-1 font-mono text-[11px] break-words text-ink-dim">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
      >
        Retry
      </button>
    </div>
  );
}

function EmptyProjects(): ReactElement {
  return (
    <p className="px-2 py-1 text-xs text-ink-dim">
      No projects yet. Drop a folder into your projects root and refresh.
    </p>
  );
}
