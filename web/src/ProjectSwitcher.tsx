import type { Project } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import { NameDialog } from './dialogs';
import { Name } from './Name';
import { useToast } from './toast/ToastProvider';
import { projectNameRefusal, type ProjectsState } from './useProjects';

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
  /**
   * Delete one project for good (ticket 90). A refusal rejects with the
   * server's sentence, which the dialog shows; on success the caller has
   * already cleared the selection when it named this project, and the toast is
   * this component's own — `deleted <name>`, beside `created <name>`.
   */
  onDelete: (project: Project) => Promise<void>;
}

/**
 * The slice's only interactive surface: the discovered projects, with the three
 * affordances that change the list — a refresh, a create, and a row's delete —
 * and the three states a fetch can leave the UI in.
 *
 * The create is a `New project` button in the header rather than a rail icon
 * (the prototype's rail carried a mocked one): projects live in this column and
 * the refresh is already here, so the thing that adds one belongs beside it. The
 * dialog is the drawer's own `NameDialog`, with the project rule — one clean
 * segment, no leading dot — in place of the drawer's.
 *
 * The delete lives on the row it destroys, behind a `⋯` menu (ticket 90): it is
 * one project's act, not the list's, and the file drawer already taught the eye
 * that a row's menu is where an entry's own actions are. Its confirmation is the
 * same `NameDialog` in its typed-name mode.
 */
export function ProjectSwitcher({
  state,
  selectedId,
  onSelect,
  onRefresh,
  onCreate,
  onDelete,
}: ProjectSwitcherProps): ReactElement {
  const loading = state.status === 'loading';
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /**
   * Which row's `⋯` menu is open, by id. It is the row's own state because the
   * menu belongs to that row and exactly one is open at a time; opening it is
   * not selecting, so nothing here touches `selectedId`.
   */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  /** The menu's one item: shut the menu, which is not selecting, and ask. */
  const openDelete = (project: Project): void => {
    setMenuFor(null);
    setDeleting(project);
    setDeleteError(null);
  };

  const submitDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await onDelete(deleting);
      setDeleting(null);
      setDeleteError(null);
      toast(`deleted ${deleting.name}`);
    } catch (error) {
      // A refusal keeps the dialog open with the server's sentence, as the
      // create's does, and leaves the list and the selection untouched.
      setDeleteError(messageOf(error));
    }
  };

  const cancelDelete = (): void => {
    setDeleting(null);
    setDeleteError(null);
  };

  return (
    // `relative`, so the create and delete dialogs centre over this column
    // rather than the window: the sidebar is the surface they belong to, as the
    // drawer is the file dialogs'.
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
                <ProjectRow
                  key={project.id}
                  project={project}
                  selected={project.id === selectedId}
                  menuOpen={menuFor === project.id}
                  onSelect={onSelect}
                  onMenuToggle={() => { setMenuFor(menuFor === project.id ? null : project.id); }}
                  onMenuClose={() => { setMenuFor(null); }}
                  onDelete={openDelete}
                />
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
          refusal={projectNameRefusal}
          onSubmit={submitCreate}
          onCancel={() => { setCreating(false); }}
        />
      )}

      {deleting !== null && (
        // The typed-name confirmation (ticket 88) with the project's own name
        // and canonical path: the directory leaves the disk for good, so the
        // dialog asks for the name exactly and says where it is.
        <NameDialog
          title="Delete project"
          confirmLabel="Delete"
          initial=""
          error={deleteError}
          typedName={{ name: deleting.name, path: deleting.path }}
          onSubmit={submitDelete}
          onCancel={cancelDelete}
        />
      )}
    </section>
  );
}

/**
 * One project row: the pick, and the `⋯` menu holding the one destructive act
 * (ticket 90). The menu button is a **sibling** of the pick, never a child:
 * opening the menu is not selecting the project, so the click cannot fall
 * through to the pick.
 *
 * Above `md` the button is revealed by the row's hover or by focus anywhere
 * inside it; below `md` it is always visible, because a touch screen has no
 * hover — there the deliberate tap on the `⋯` *is* the affordance, rather than
 * a tap anywhere on the row doing something the user did not aim at.
 */
function ProjectRow({
  project,
  selected,
  menuOpen,
  onSelect,
  onMenuToggle,
  onMenuClose,
  onDelete,
}: {
  project: Project;
  selected: boolean;
  menuOpen: boolean;
  onSelect: (project: Project) => void;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onDelete: (project: Project) => void;
}): ReactElement {
  return (
    <li>
      {/* `relative`, so the menu hangs off this row rather than the sidebar;
          `group`, so the whole row is what reveals its `⋯`. */}
      <div
        className={`group relative flex items-center rounded ${
          selected ? 'bg-white/10' : 'hover:bg-white/5'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            onSelect(project);
          }}
          aria-current={selected}
          title={project.path}
          className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${
            selected ? 'text-ink' : 'text-ink-dim group-hover:text-ink'
          }`}
        >
          <Name>{project.name}</Name>
        </button>
        <button
          type="button"
          aria-label={`Actions for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onMenuToggle}
          className={`mr-1 shrink-0 rounded px-1.5 py-1 text-ink-dim hover:bg-white/10 hover:text-ink focus-visible:outline-1 focus-visible:outline-accent ${
            menuOpen ? '' : 'md:opacity-0'
          } md:group-hover:opacity-100 md:group-focus-within:opacity-100`}
        >
          ⋯
        </button>

        {menuOpen && (
          <>
            {/* A tap anywhere else shuts the menu without choosing anything. */}
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-10 cursor-default"
              onClick={onMenuClose}
            />
            <div
              role="menu"
              aria-label={`Actions for ${project.name}`}
              className="absolute top-full right-0 z-20 mt-1 flex w-32 flex-col rounded border border-line bg-panel py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { onDelete(project); }}
                className="px-3 py-1 text-left text-[11px] text-err hover:bg-white/5"
              >
                Delete…
              </button>
            </div>
          </>
        )}
      </div>
    </li>
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
