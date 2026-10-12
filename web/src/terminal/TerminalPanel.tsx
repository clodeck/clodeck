import type { Project } from '@clodeck/shared';
import type { ReactElement } from 'react';

import { useTerminal, type TerminalConnection } from './useTerminal';

/**
 * The per-project shell — the view half of `useTerminal`. It is only a titled
 * cell whose body is the container xterm mounts into; every imperative detail
 * (the instance, the socket, fit, resize) lives in the seam. It is keyed by
 * project id in `App`'s drawer, exactly as `ChatPanel` is, so switching projects
 * remounts a fresh shell and the previous socket is torn down. Mounting is also
 * what fits it: the drawer mounts this panel only while its tab is showing, so
 * opening the drawer, switching to the tab, and closing it are all mount and
 * unmount — there is no half-rendered xterm to re-fit.
 */
export function TerminalPanel({ project }: { project: Project }): ReactElement {
  const { connection, containerRef } = useTerminal(project);

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Terminal">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Terminal</h2>
          <ConnectionPill connection={connection} />
        </div>
      </header>
      {/* Terminal bytes have exactly one sink: xterm's own renderer. */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-canvas" />
    </section>
  );
}

function ConnectionPill({ connection }: { connection: TerminalConnection }): ReactElement {
  const label = connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Closed';
  const tone = connection === 'live' ? 'text-accent' : 'text-ink-dim';
  return <span className={`text-[11px] ${tone}`}>{label}</span>;
}
