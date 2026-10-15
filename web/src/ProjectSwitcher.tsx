import type { Project } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import { NameDialog } from './dialogs';
import { Name } from './Name';
import { useToast } from './toast/ToastProvider';
import { isValidProjectName, type ProjectsState } from './useProjects';

interface ProjectSwitcherProps {
  state: ProjectsState;
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
  /**
   * Create one project directory (ticket 47). A refusal rejects with the
   * server's message, which the dialog shows; on success the caller has already
   * selected the new project by the time this resolves.
   */
  onCreate: (name: string) => Promise<void>;
}

/**
 * The slice's only interactive surface: the discovered projects, with the two
 * affordances that change the list — a refresh, and a create — and the three
 * states a fetch can leave the UI in.
 *
 * The create is a `New project` button in the header rather than a rail icon
 * (the prototype's rail carried a mocked one): projects live in this column and
 * the refresh is already here, so the thing that adds one belongs beside it. The
 * dialog is the drawer's own `NameDialog`, with the project rule — one clean
 * segment, no leading dot — in place of the drawer's.
 */
export function ProjectSwitcher({
  state,
  selectedId,
  onSelect,
  onRefresh,
  onCreate,
}: ProjectSwitcherProps): ReactElement {
  const loading = state.status === 'loading';
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const toast = useToast();

  const openCreate = (): void => {
    setCreating(true);
    setCreateError(null);
  };

  const submitCreate = async (name: string): Promise<void> => {
    try {
      await onCreate(name);
      setCreating(false);
      toast(`created ${name}`);
    } catch (error) {
      // The server's refusal keeps the dialog open, exactly as the drawer's
      // rename does — and the list is left exactly as it was.
      setCreateError(messageOf(error));
    }
  };

  return (
    // `relative`, so the create dialog centres over this column rather than the
    // window: the sidebar is the surface it belongs to, as the drawer is the
    // file dialogs'.
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Projects" aria-busy={loading}>
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Projects</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openCreate}
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            New project
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && <LoadingProjects />}
        {state.status === 'error' && <ErrorProjects message={state.message} onRetry={onRefresh} />}
        {state.status === 'ready' &&
          (state.projects.length === 0 ? (
            <EmptyProjects onNew={openCreate} />
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
                    <Name>{project.name}</Name>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>

      {creating && (
        <NameDialog
          title="New project"
          confirmLabel="Create"
          initial=""
          error={createError}
          isValid={isValidProjectName}
          onSubmit={submitCreate}
          onCancel={() => { setCreating(false); }}
        />
      )}
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

/**
 * The empty state: still the honest sentence about the disk — a folder dropped
 * into the root really does appear on refresh — with the create button beside it
 * so it is no longer a dead end for someone behind the login with no shell.
 */
function EmptyProjects({ onNew }: { onNew: () => void }): ReactElement {
  return (
    <div className="px-2 py-1">
      <p className="text-xs text-ink-dim">
        No projects yet. Drop a folder into your projects root and refresh.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="mt-2 rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
      >
        New project
      </button>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
