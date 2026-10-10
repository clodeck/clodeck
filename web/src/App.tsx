import type { Project } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import { ChatPanel } from './chat/ChatPanel';
import { FilePanel } from './files/FilePanel';
import { ProjectSwitcher } from './ProjectSwitcher';
import { TerminalPanel } from './terminal/TerminalPanel';
import { useProjects } from './useProjects';

/**
 * The app shell: the project switcher in the sidebar, and the workspace it fills
 * — chat, terminal, files — beside it.
 */
export function App(): ReactElement {
  const { state, reload } = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derived, never stored: a project that disappears on refresh simply stops
  // being selected, instead of lingering as a dangling id.
  const selected =
    state.status === 'ready' ? (state.projects.find((project) => project.id === selectedId) ?? null) : null;

  return (
    <div className="flex h-screen bg-canvas text-ink">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
        <header className="border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Clodeck</p>
          <p className="font-mono text-[11px] text-ink-dim">remote Claude Code</p>
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

function NothingSelected(): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-ink-dim">Select a project to begin.</p>
    </div>
  );
}

function WorkspacePlaceholder({ project }: { project: Project }): ReactElement {
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
              tears the previous socket down with the old panel). */}
          <TerminalPanel key={project.id} project={project} />
          {/* Keyed by project so switching projects remounts a fresh drawer
              (path, listing, and preview) instead of carrying one project's
              view into another. */}
          <FilePanel key={project.id} project={project} />
        </div>
      </div>
    </>
  );
}
