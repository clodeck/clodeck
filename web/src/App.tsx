import type { Project } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import { LoginScreen } from './auth/LoginScreen';
import { useAuth } from './auth/useAuth';
import { ChatPanel } from './chat/ChatPanel';
import { FilePanel } from './files/FilePanel';
import { ProjectSwitcher } from './ProjectSwitcher';
import { TerminalPanel } from './terminal/TerminalPanel';
import { useProjects } from './useProjects';

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
 * The workspace itself: the project switcher in the sidebar, and the panels it
 * fills beside it.
 */
function Shell({ onLogout }: { onLogout: () => Promise<void> }): ReactElement {
  const { state, reload } = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derived, never stored: a project that disappears on refresh simply stops
  // being selected, instead of lingering as a dangling id.
  const selected =
    state.status === 'ready' ? (state.projects.find((project) => project.id === selectedId) ?? null) : null;

  return (
    <div className="flex h-screen bg-canvas text-ink">
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
          onSelect={(project) => {
            setSelectedId(project.id);
          }}
          onRefresh={reload}
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selected === null ? <NothingSelected /> : <WorkspacePlaceholder project={selected} />}
      </main>
    </div>
  );
}

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

export function WorkspacePlaceholder({ project }: { project: Project }): ReactElement {
  return (
    <>
      <header className="flex items-baseline gap-3 border-b border-line px-5 py-3">
        <h1 className="text-sm font-semibold">{project.name}</h1>
        <span className="truncate font-mono text-[11px] text-ink-dim" title={project.path}>
          {project.path}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        {/* Keyed by project so switching projects remounts a fresh chat session. */}
        <ChatPanel key={project.id} project={project} />
        <div className="grid min-h-0 grid-rows-2 divide-y divide-line">
          {/* Keyed by project so switching projects remounts a fresh shell (and
              tears the previous socket down with the old panel), and the file
              drawer likewise. The keys carry a panel prefix because these two
              are siblings: a shared `project.id` is a *duplicate key*, and
              React's key map holds one entry per key, so the first sibling drops
              out of its bookkeeping and is never unmounted — the old terminal
              then stays on screen while a new one is appended below it. */}
          <TerminalPanel key={`terminal:${project.id}`} project={project} />
          <FilePanel key={`files:${project.id}`} project={project} />
        </div>
      </div>
    </>
  );
}
