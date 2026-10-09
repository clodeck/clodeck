import type { ResumePayload, SessionMessage, SessionSummary } from '@clodeck/shared';
import { useMemo, type ReactElement } from 'react';

import { EntryView } from './EntryView';
import { fromSessionMessages } from './reducer';
import type { SessionsState, TranscriptState } from './useSessions';

/**
 * The history surface: a list of past sessions under the chat header, and the
 * read-only transcript of whichever one is opened. Both render through
 * `EntryView`, the same renderer the live chat uses, because the reducer folds a
 * stored `SessionMessage[]` into the identical view model (ticket 11).
 */

/** Stable empty input so the transcript memo does not recompute on every render. */
const NO_MESSAGES: readonly SessionMessage[] = [];

export function SessionBrowser({
  state,
  currentSessionId,
  onReload,
  onOpen,
  onResume,
  onClose,
}: {
  state: SessionsState;
  /** The live session's id, if the run has named one — marked as the current row. */
  currentSessionId: string | null;
  onReload: () => void;
  onOpen: (sessionId: string) => void;
  onResume: (target: ResumePayload) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <div className="border-b border-line bg-panel/60 px-4 py-2" aria-label="Session history">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Past sessions</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReload}
            disabled={state.status === 'loading'}
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink disabled:opacity-40"
          >
            {state.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close session history"
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          onResume({ mode: 'continue' });
        }}
        className="mt-2 w-full rounded border border-line px-2 py-1.5 text-left text-sm text-ink hover:bg-white/5"
      >
        Continue latest
        <span className="block text-[10px] text-ink-dim">Resume the most recent session — no id needed.</span>
      </button>

      {state.status === 'loading' && (
        <p className="mt-2 text-xs text-ink-dim" role="status">
          Loading sessions…
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-2 text-xs text-err" role="alert">
          Could not load sessions: {state.message}
        </p>
      )}
      {state.status === 'ready' && state.sessions.length === 0 && (
        <p className="mt-2 text-xs text-ink-dim">No past sessions yet.</p>
      )}
      {state.status === 'ready' && state.sessions.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto">
          {state.sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onOpen(session.id);
                }}
                title={session.id}
                className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm text-ink-dim hover:bg-white/5 hover:text-ink"
              >
                {session.title}
                {session.id === currentSessionId && <span className="ml-1.5 text-[10px] text-accent">current</span>}
              </button>
              <button
                type="button"
                onClick={() => {
                  onResume({ sessionId: session.id });
                }}
                className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
              >
                Resume
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TranscriptPanel({
  state,
  onResume,
  onClose,
}: {
  state: TranscriptState;
  onResume: (target: ResumePayload) => void;
  onClose: () => void;
}): ReactElement | null {
  // Hook runs before the status branches: history is folded once per transcript.
  const messages = state.status === 'ready' ? state.messages : NO_MESSAGES;
  const view = useMemo(() => fromSessionMessages(messages), [messages]);

  if (state.status === 'closed') return null;
  if (state.status === 'loading') {
    return (
      <p className="text-sm text-ink-dim" role="status">
        Loading transcript…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="rounded border border-err/40 bg-err/10 p-3" role="alert">
        <p className="text-xs font-semibold text-err">Could not load this transcript</p>
        <p className="mt-1 font-mono text-[11px] break-words text-ink-dim">{state.message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
        >
          Back to live
        </button>
      </div>
    );
  }

  const { sessionId } = state;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <span className="text-[11px] tracking-wider text-ink-dim uppercase">History · {sessionId.slice(0, 8)}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onResume({ sessionId });
            }}
            className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-canvas hover:opacity-90"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => {
              onResume({ sessionId, fork: true });
            }}
            className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
          >
            Resume in a fork
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            Back to live
          </button>
        </div>
      </div>

      {view.entries.length === 0 ? (
        <p className="text-sm text-ink-dim">This session has no recorded turns.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {view.entries.map((entry, index) => (
            <li key={index}>
              <EntryView entry={entry} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The stored title for the session a resume target names, when the list has it. */
export function resumeTargetTitle(state: SessionsState, target: ResumePayload | null): string | null {
  if (target === null || 'mode' in target || state.status !== 'ready') return null;
  return state.sessions.find((session: SessionSummary) => session.id === target.sessionId)?.title ?? null;
}
