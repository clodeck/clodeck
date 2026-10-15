import type { Project } from '@clodeck/shared';
import { useCallback, useState, type ReactElement } from 'react';

import { LoginScreen } from './auth/LoginScreen';
import { useAuth } from './auth/useAuth';
import { ChatPanel } from './chat/ChatPanel';
import { FilePanel } from './files/FilePanel';
import { ProjectSwitcher } from './ProjectSwitcher';
import { TerminalPanel } from './terminal/TerminalPanel';
import { ToastProvider } from './toast/ToastProvider';
import { useProjects, type ProjectsState } from './useProjects';

/**
 * The app shell, and the gate in front of it (spec-05 §"Shared + web client").
 *
 * The gate is a *mount* boundary, not a routing one: while there is no session
 * nothing below it exists, so no panel fetches and no socket opens before the
 * user is logged in. That is also why `useProjects` lives in `Shell` — a hook
 * cannot be called conditionally, so the rule is enforced by where the component
 * is mounted rather than by a flag.
 */
export function App(): ReactElement {
  const { status, login, logout } = useAuth();

  switch (status) {
    case 'checking':
      return <CheckingSession />;
    case 'unauthenticated':
      return <LoginScreen login={login} />;
    case 'authenticated':
      return <Shell onLogout={logout} />;
  }
}

/**
 * Which tool the bottom drawer is showing. `null` is the shut drawer, which is
 * the same thing as "the chat has the stage" — the three rail buttons are one
 * choice, not three independent toggles.
 */
export type DrawerTab = 'terminal' | 'files' | null;

/** The hooks, and the layout they feed — see {@link Workspace} for the split. */
function Shell({ onLogout }: { onLogout: () => Promise<void> }): ReactElement {
  const { state, reload, create } = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Create a project and land in it. The selection is set by **id alone**: the
   * row itself comes from the reloaded list, so no second copy of the project is
   * held anywhere — `Workspace`'s derived `selected` resolves the id as soon as
   * the list carries it. A refusal propagates to the dialog that asked.
   */
  const createProject = useCallback(
    async (name: string): Promise<void> => {
      const project = await create(name);
      setSelectedId(project.id);
      reload();
    },
    [create, reload],
  );

  return (
    <Workspace
      state={state}
      selectedId={selectedId}
      onSelect={(project) => {
        setSelectedId(project.id);
      }}
      onRefresh={reload}
      onCreate={createProject}
      onLogout={onLogout}
    />
  );
}

interface WorkspaceProps {
  state: ProjectsState;
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onRefresh: () => void;
  /** Create a project by name; the shell selects it and reloads the list. */
  onCreate: (name: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

/**
 * The authenticated workspace, prop-driven so it can be rendered without a
 * network: the icon rail ▸ the project sidebar ▸ the chat stage, with the
 * terminal and the file viewer in **one bottom drawer** the rail summons
 * (Variant A, decision 03).
 *
 * The drawer's tab is *workspace* state, held here rather than in the panels: it
 * outlives a project switch, so picking another project keeps the tab and only
 * rebuilds that tab's body for the new project.
 *
 * Its toast provider ({@link ToastProvider}) wraps the whole shell: the panels
 * in the drawer speak through it, and its surface is rendered as the workspace's
 * sibling rather than a child of the drawer, which would clip it.
 */
export function Workspace({
  state,
  selectedId,
  onSelect,
  onRefresh,
  onCreate,
  onLogout,
}: WorkspaceProps): ReactElement {
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(null);

  // Derived, never stored: a project that disappears on refresh simply stops
  // being selected, instead of lingering as a dangling id.
  const selected =
    state.status === 'ready' ? (state.projects.find((project) => project.id === selectedId) ?? null) : null;

  return (
    <ToastProvider>
      <div className="flex h-screen bg-canvas text-ink">
        {/* The drawer lives *inside* the stage, so Terminal and Files have
            nothing to draw without a project; Chat is the stage's own shut
            state and needs none. */}
        <Rail tab={drawerTab} onTab={setDrawerTab} hasProject={selected !== null} />

        <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Clodeck</p>
              <p className="font-mono text-[11px] text-ink-dim">remote Claude Code</p>
            </div>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
            >
              Log out
            </button>
          </header>
          <ProjectSwitcher
            state={state}
            selectedId={selectedId}
            onSelect={onSelect}
            onRefresh={onRefresh}
            onCreate={onCreate}
          />
        </aside>

        {/* The stage column: the chat on top, and the drawer (when open) below
            it, shrinking the chat rather than covering it. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selected === null ? (
            <NothingSelected />
          ) : (
            <ChatStage project={selected} drawerTab={drawerTab} onDrawerTab={setDrawerTab} />
          )}
        </div>
      </div>
    </ToastProvider>
  );
}

/**
 * The chat stage of one project, plus the drawer under it. Only the three
 * rail buttons' *choice* is passed down; the panels below own nothing about
 * where they live.
 */
function ChatStage({
  project,
  drawerTab,
  onDrawerTab,
}: {
  project: Project;
  drawerTab: DrawerTab;
  onDrawerTab: (tab: DrawerTab) => void;
}): ReactElement {
  return (
    <>
      <header className="flex items-baseline gap-3 border-b border-line px-5 py-3">
        <h1 className="text-sm font-semibold">{project.name}</h1>
        <span className="truncate font-mono text-[11px] text-ink-dim" title={project.path}>
          {project.path}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {/* Keyed by project so switching projects remounts a fresh chat session. */}
        <ChatPanel key={project.id} project={project} />
      </main>

      {/* Terminal and file drawer share one summonable strip: exactly one of them
          is mounted, so the terminal is re-fitted by being remounted when the
          drawer opens, when its tab is switched to, and torn down when it closes. */}
      {drawerTab !== null && <Drawer tab={drawerTab} onTab={onDrawerTab} project={project} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The rail                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The two tones a piece of the shell's chrome wears (ticket 49) — the
 * prototype's `.icon-btn` (`styles.css:58-59`): resting, a step up on hover, and
 * two steps up when it is the current one. The rail's buttons and the drawer's
 * tabs are that same control there, so they wear the same two levels here and
 * differ only in the text colour, which stays each caller's own.
 */
const CHROME_TONE = { current: 'bg-bg-4', resting: 'text-ink-dim hover:bg-bg-3 hover:text-ink' } as const;

/** Why a rail button is shut, said in its `title` (ticket 57). */
const NO_PROJECT_REASON = 'choose a project first';

/**
 * The far-left icon rail: the product's three surfaces, one at a time. Chat is
 * active while the drawer is shut, so exactly one button always reads as pressed.
 *
 * Terminal and Files are **disabled** until a project is selected, and that is
 * the deliberate half of ticket 57: the tab used to be recorded anyway, so a
 * click here did nothing visible and then opened a drawer later, once a project
 * was picked — a selection the user had long stopped thinking about. A control
 * that cannot do its job says so instead of quietly remembering. Chat is never
 * disabled: shutting the drawer is the stage's own state, and needs no project.
 */
function Rail({
  tab,
  onTab,
  hasProject,
}: {
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  /** Whether there is a project for the drawer's panels to be built from. */
  hasProject: boolean;
}): ReactElement {
  return (
    <nav
      aria-label="Workspace"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel pt-3"
    >
      <span
        aria-hidden="true"
        title="Clodeck"
        className="mb-2 flex h-7 w-7 items-center justify-center rounded bg-accent/15 font-mono text-[13px] font-semibold text-accent"
      >
        C
      </span>
      <RailButton icon="chat" label="Chat" active={tab === null} onClick={() => { onTab(null); }} />
      <RailButton
        icon="terminal"
        label="Terminal"
        active={tab === 'terminal'}
        disabled={!hasProject}
        onClick={() => { onTab('terminal'); }}
      />
      <RailButton
        icon="files"
        label="Files"
        active={tab === 'files'}
        disabled={!hasProject}
        onClick={() => { onTab('files'); }}
      />
    </nav>
  );
}

function RailButton({
  icon,
  label,
  active,
  onClick,
  disabled = false,
}: {
  icon: 'chat' | 'terminal' | 'files';
  label: string;
  active: boolean;
  onClick: () => void;
  /** Shut for want of a project; the `title` carries the reason. */
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={disabled ? `${label} — ${NO_PROJECT_REASON}` : label}
      disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded disabled:opacity-40 ${
        active ? `${CHROME_TONE.current} text-accent` : CHROME_TONE.resting
      }`}
    >
      <RailIcon name={icon} />
    </button>
  );
}

/** Three strokes each; decorative, so the button's `aria-label` is the name. */
function RailIcon({ name }: { name: 'chat' | 'terminal' | 'files' }): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
    >
      {name === 'chat' && (
        <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h8a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 14H8.5l-4 2.5V14A2.5 2.5 0 0 1 3.5 11.5z" />
      )}
      {name === 'terminal' && (
        <>
          <path d="M4.5 6.5 8 10l-3.5 3.5" />
          <path d="M11 13.5h4.5" />
        </>
      )}
      {name === 'files' && (
        <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h3l1.5 2h5.5A1.5 1.5 0 0 1 16.5 8.5v5A1.5 1.5 0 0 1 15 15H5a1.5 1.5 0 0 1-1.5-1.5z" />
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* The drawer                                                                 */
/* -------------------------------------------------------------------------- */

/** About 42vh: enough for a shell or a tree, never the whole stage. */
const DRAWER_TABS = [
  { tab: 'terminal', label: 'Terminal' },
  { tab: 'files', label: 'Files' },
] as const;

/**
 * The one bottom drawer. It is a strip *inside* the stage column, so opening it
 * shrinks the chat instead of overlaying it, and it carries its own header —
 * the two tabs and the close button — because the rail only says which tool you
 * want, not which one you are looking at.
 */
function Drawer({
  tab,
  onTab,
  project,
}: {
  tab: 'terminal' | 'files';
  onTab: (tab: DrawerTab) => void;
  project: Project;
}): ReactElement {
  return (
    <section
      aria-label="Drawer"
      className="flex h-[42vh] min-h-0 shrink-0 flex-col border-t border-line bg-panel"
    >
      {/* Ticket 49: the drawer's own chrome is a surface of its own — the tab
          strip on the scale's second step (the prototype's `.panel-head`,
          `styles.css:61-66`). */}
      <div role="tablist" aria-label="Drawer panel" className="flex items-center gap-1 border-b border-line bg-bg-2 px-2 py-1">
        {DRAWER_TABS.map(({ tab: id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => { onTab(id); }}
            className={`rounded px-2 py-1 text-[11px] ${
              tab === id ? `${CHROME_TONE.current} text-ink` : CHROME_TONE.resting
            }`}
          >
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close drawer"
          onClick={() => { onTab(null); }}
          className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
        >
          ✕
        </button>
      </div>

      {/* Both panels are keyed by project so switching projects remounts a fresh
          one. The keys carry a panel prefix on purpose: these two are the
          siblings a shared `project.id` once collided on, and a duplicate key
          drops the first sibling out of React's bookkeeping, so it is never
          unmounted. One panel at a time makes that collision unlikely; the
          prefixes keep it impossible if a later ticket mounts both. */}
      {tab === 'terminal' ? (
        <TerminalPanel key={`terminal:${project.id}`} project={project} />
      ) : (
        <FilePanel key={`files:${project.id}`} project={project} />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Frames                                                                     */
/* -------------------------------------------------------------------------- */

/** The session check itself: no spinner row, just the shell's frame staying empty. */
function CheckingSession(): ReactElement {
  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <p className="text-xs text-ink-dim" role="status">
        Checking your session…
      </p>
    </div>
  );
}

function NothingSelected(): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-ink-dim">Select a project to begin.</p>
    </div>
  );
}
