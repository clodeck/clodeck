import type { Project } from '@clodeck/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { LoginScreen } from './auth/LoginScreen';
import { useAuth } from './auth/useAuth';
import { ChatPanel } from './chat/ChatPanel';
import { FilePanel } from './files/FilePanel';
import { Icon } from './icons';
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
  // The sidebar is an off-canvas overlay below `md`, and a fixed column above
  // it: one piece of state, read only by the narrow layout (`md:` restores the
  // desktop column regardless).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Escape is the sidebar's third way out, after the scrim and a project pick.
  // It is bound while the overlay is open rather than always, so it never eats
  // the key from something else on the desktop.
  useEffect(() => {
    if (!sidebarOpen) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); };
  }, [sidebarOpen]);

  // Derived, never stored: a project that disappears on refresh simply stops
  // being selected, instead of lingering as a dangling id.
  const selected =
    state.status === 'ready' ? (state.projects.find((project) => project.id === selectedId) ?? null) : null;

  // The rail can draw a drawer as soon as a project is *chosen*, and an id on
  // its own is chosen: a create sets the id and then reloads the list, so the
  // resolved project lags its own selection by a round trip. Gating on
  // `selected` alone shut the rail for the whole of every create and every
  // refresh — a window the user did not choose to be in, and not the one ticket
  // 57 is about. Once the list lands the id has to resolve, because an id that
  // no longer names a project is not a project.
  const railHasProject = selected !== null || (selectedId !== null && state.status === 'loading');

  return (
    <ToastProvider>
      {/* One breakpoint, `md` (768px), decides the layout: a row of rail ▸
          sidebar ▸ stage on desktop, a column of stage ▸ bottom nav on a phone.
          `overflow-hidden` is the shell's promise that no child can turn the
          page itself into a horizontal scroller.
          The height is the *dynamic* viewport, not `h-screen`: on a phone the
          100vh a plain `h-screen` resolves to is the largest viewport — the one
          with the browser's own toolbar retracted — so the bottom nav was laid
          out below the visible edge and Chrome's address bar sat on top of it.
          `dvh` follows the viewport the user can actually see. */}
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink md:flex-row">
        {/* The drawer lives *inside* the stage, so Terminal and Files have
            nothing to draw without a project; Chat is the stage's own shut
            state and needs none. */}
        <WorkspaceNav tab={drawerTab} onTab={setDrawerTab} hasProject={railHasProject} />

        {/* The scrim is the overlay's second way out: a full-window button that
            sits under the sidebar and over everything it covers. It exists only
            while the overlay does, and only below `md`. */}
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close projects"
            onClick={() => { setSidebarOpen(false); }}
            className="fixed inset-0 z-20 cursor-default bg-canvas/70 md:hidden"
          />
        )}

        {/* Off-canvas below `md`, where `fixed` takes it out of the column and
            `-translate-x-full` parks it off screen; `invisible` is what keeps
            its controls out of the tab order while it is shut. Desktop pins it
            back into the row as the same `w-72` column it always was. */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel transition-transform md:static md:z-auto md:max-w-none md:shrink-0 md:translate-x-0 md:visible md:transition-none ${
            sidebarOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
          }`}
        >
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
            onSelect={(project) => {
              onSelect(project);
              // A pick is the overlay's third way out — the one that also does
              // what the overlay is for.
              setSidebarOpen(false);
            }}
            onRefresh={onRefresh}
            onCreate={onCreate}
          />
        </aside>

        {/* The stage column: the chat on top, and (above `md`) the drawer below
            it, shrinking the chat rather than covering it. Below `md` the
            drawer is a full-screen sheet instead and this column is what it
            covers. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The narrow layout's top bar: the sidebar's only door once it is
              off-canvas, and its own row so it is there before a project is
              chosen too. Desktop keeps the rail and the sidebar instead. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-1.5 md:hidden">
            <button
              type="button"
              aria-label="Open projects"
              aria-expanded={sidebarOpen}
              onClick={() => { setSidebarOpen(true); }}
              className="flex h-8 w-8 items-center justify-center rounded text-ink-dim hover:bg-white/5 hover:text-ink"
            >
              <Icon name="menu" />
            </button>
            <span className="text-sm font-semibold">Clodeck</span>
          </div>

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
      {/* The path is the only thing that may shrink: a long name would
          otherwise push it out of the narrow layout entirely. */}
      <header className="flex min-w-0 items-baseline gap-3 border-b border-line px-5 py-3">
        <h1 className="shrink-0 text-sm font-semibold">{project.name}</h1>
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-dim" title={project.path}>
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
 *
 * The hover step is `enabled:` because `:hover` still matches a *disabled*
 * button, which left a shut rail button lighting up under the pointer exactly
 * like a live one (ticket 57). The drawer's tabs are never disabled, so the
 * qualifier changes nothing for them.
 */
const CHROME_TONE = {
  current: 'bg-bg-4',
  resting: 'text-ink-dim enabled:hover:bg-bg-3 enabled:hover:text-ink',
} as const;

/** Why a rail button is shut, said in its `title` (ticket 57). */
const NO_PROJECT_REASON = 'choose a project first';

/**
 * The product's three surfaces, one at a time: the far-left icon rail on
 * desktop, the bottom nav on a phone. It is **one** element drawn twice by
 * `md:` — not a rail and a nav with a button set each — because two sets would
 * be two sources of the same `DrawerTab` state and two of every control for a
 * screen reader to meet.
 *
 * Chat is active while the drawer is shut, so exactly one button always reads as
 * pressed.
 *
 * Terminal and Files are **disabled** until a project is chosen, and that is
 * the deliberate half of ticket 57: the tab used to be recorded anyway, so a
 * click here did nothing visible and then opened a drawer later, once a project
 * was picked — a selection the user had long stopped thinking about. A control
 * that cannot do its job says so instead of quietly remembering. Chat is never
 * disabled: shutting the drawer is the stage's own state, and needs no project.
 *
 * "Chosen" is the id, not the resolved project: the list is in flight for the
 * whole of every create and every refresh, and the nav is not shut for those.
 *
 * At the bottom edge the nav carries the safe-area inset itself, and it is the
 * last row of the phone's column — so the stage (and the composer at its foot)
 * always ends above the home indicator rather than under it.
 */
function WorkspaceNav({
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
      className="order-last flex shrink-0 flex-row items-stretch justify-around gap-1 border-t border-line bg-panel px-2 pt-1 pb-[env(safe-area-inset-bottom)] md:order-none md:w-[52px] md:flex-col md:items-center md:justify-start md:border-t-0 md:border-r md:px-0 md:pt-3 md:pb-0"
    >
      <span
        aria-hidden="true"
        title="Clodeck"
        className="mb-2 hidden h-7 w-7 items-center justify-center rounded bg-accent/15 font-mono text-[13px] font-semibold text-accent md:flex"
      >
        C
      </span>
      <NavButton icon="chat" label="Chat" active={tab === null} onClick={() => { onTab(null); }} />
      <NavButton
        icon="terminal"
        label="Terminal"
        active={tab === 'terminal'}
        disabled={!hasProject}
        onClick={() => { onTab('terminal'); }}
      />
      <NavButton
        icon="folder"
        label="Files"
        active={tab === 'files'}
        disabled={!hasProject}
        onClick={() => { onTab('files'); }}
      />
    </nav>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
  disabled = false,
}: {
  icon: 'chat' | 'terminal' | 'folder';
  label: string;
  active: boolean;
  onClick: () => void;
  /** Shut for want of a project; the `title` carries the reason. */
  disabled?: boolean;
}): ReactElement {
  // A shut button hands the reason to two readers who arrive differently. The
  // disabled control itself gets no pointer events, so its own `title` never
  // becomes a tooltip — a mouse has to hover the wrapper, which is why the
  // reason is on both. A screen reader takes the accessible description from
  // that same attribute, and reaches the control whether or not it is focusable.
  const reason = disabled ? `${label} — ${NO_PROJECT_REASON}` : null;

  return (
    // `flex-1` makes each of the three a third of the phone's width; the rail's
    // buttons stay the 36px squares they were.
    <span title={reason ?? undefined} className="flex flex-1 md:block md:flex-none">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        title={reason ?? label}
        disabled={disabled}
        className={`flex w-full flex-col items-center justify-center gap-0.5 rounded py-1 text-[10px] disabled:opacity-40 md:h-9 md:w-9 md:gap-0 md:py-0 ${
          active ? `${CHROME_TONE.current} text-accent` : CHROME_TONE.resting
        }`}
      >
        <Icon name={icon} />
        {/* The rail said each surface with its icon and its `aria-label`; the
            phone has the room to say it in words as well, and a thumb benefits. */}
        <span className="md:hidden">{label}</span>
      </button>
    </span>
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
 * The one bottom drawer, drawn two ways. Above `md` it is a 42vh strip *inside*
 * the stage column, so opening it shrinks the chat instead of overlaying it.
 * Below `md` it is a full-screen sheet: `fixed inset-0` covers the stage and the
 * bottom nav, and the chat stays mounted behind it — covered, never torn down
 * and rebuilt. The tab is the same workspace state either way, so a switch from
 * terminal to files, or a project switch under an open drawer, is the same
 * choice it always was.
 *
 * It carries its own header — the two tabs and the close button — because the
 * nav only says which tool you want, not which one you are looking at; on the
 * sheet that close button is the way back to the chat.
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
      className="fixed inset-0 z-40 flex h-full min-h-0 flex-col border-t border-line bg-panel md:static md:z-auto md:h-[42vh] md:shrink-0"
    >
      {/* Ticket 49: the drawer's own chrome is a surface of its own — the tab
          strip on the scale's second step (the prototype's `.panel-head`,
          `styles.css:61-66`). On the sheet the strip sits at the very top of
          the viewport, so it takes the top inset too. */}
      <div
        role="tablist"
        aria-label="Drawer panel"
        className="flex items-center gap-1 border-b border-line bg-bg-2 px-2 pt-[env(safe-area-inset-top)] pb-1 md:pt-1"
      >
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
