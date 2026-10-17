import type { ResumePayload, SessionMessage, SessionSummary } from '@clodeck/shared';
import { useMemo, useState, type ReactElement } from 'react';

import { Overlay } from '../dialogs';
import { ChatColumn } from './ChatColumn';
import { EntryView } from './EntryView';
import { TURN_RUNNING } from './reasons';
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
  runningSessionId,
  onReload,
  onOpen,
  onResume,
  onClose,
  onDelete,
}: {
  state: SessionsState;
  /** The live session's id, if the run has named one — marked as the current row. */
  currentSessionId: string | null;
  /** The session the live turn is writing, if it has named one — its delete is shut. */
  runningSessionId: string | null;
  onReload: () => void;
  onOpen: (sessionId: string) => void;
  onResume: (target: ResumePayload) => void;
  onClose: () => void;
  /** Deletes one session; a rejection is the server's reason, shown in the dialog. */
  onDelete: (sessionId: string) => Promise<void>;
}): ReactElement {
  const [confirming, setConfirming] = useState<SessionSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = async (): Promise<void> => {
    if (confirming === null) return;
    try {
      await onDelete(confirming.id);
      setConfirming(null);
      setDeleteError(null);
    } catch (error) {
      setDeleteError(messageOf(error));
    }
  };

  // The browser's own rule and wash are full-bleed — it is a surface of the
  // chat, not of the column — and the list it draws is in the chat's band.
  return (
    <div className="border-b border-line bg-panel/60 py-2" aria-label="Session history">
      <ChatColumn>
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
                {/* A writing turn's transcript is not the user's to delete. The
                    reason rides a wrapper as well: a disabled button gets no
                    pointer events, so its own `title` never becomes a tooltip
                    (the rail's rule, ticket 57). */}
                <span title={session.id === runningSessionId ? TURN_RUNNING : undefined}>
                  <button
                    type="button"
                    disabled={session.id === runningSessionId}
                    title={session.id === runningSessionId ? TURN_RUNNING : undefined}
                    aria-label={`Delete ${session.title}`}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirming(session);
                    }}
                    className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ChatColumn>

      {confirming !== null && (
        <DeleteSessionDialog
          session={confirming}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => {
            setConfirming(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The one confirmation before a hard delete: the transcript goes from disk with
 * no trash behind it, so the dialog says exactly that rather than asking a
 * generic "are you sure". The server's refusal (a turn writing the session)
 * lands in the same dialog and leaves it open (ticket 79).
 */
function DeleteSessionDialog({
  session,
  error,
  onConfirm,
  onCancel,
}: {
  session: SessionSummary;
  error: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  return (
    <Overlay label="Confirm session delete">
      <h3 className="text-sm font-semibold text-ink">Delete “{session.title}”?</h3>
      <p className="mt-2 text-[12px] text-err">This transcript is deleted from disk for good.</p>
      <p className="mt-1 text-[12px] text-ink-dim">It can no longer be resumed, and there is no undo.</p>
      {error !== null && (
        <p className="mt-2 font-mono text-[11px] break-words text-err" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void onConfirm();
          }}
          className="rounded bg-err px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90"
        >
          Delete
        </button>
      </div>
    </Overlay>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/**
 * The stored title for a session id, when the list has it. Both questions the
 * chat asks about a session — which one it is *in* (the header) and which one a
 * resume will continue (the banner) — are answered here, so the two surfaces
 * show one string rather than two spellings of it (ticket 74). Nothing is
 * answered for a session the list has not caught up with: the id is the honest
 * fallback, and it is the caller's to make.
 */
export function sessionTitle(state: SessionsState, sessionId: string | null): string | null {
  if (sessionId === null || state.status !== 'ready') return null;
  return state.sessions.find((session: SessionSummary) => session.id === sessionId)?.title ?? null;
}

/** The stored title for the session a resume target names. `continue` names none. */
export function resumeTargetTitle(state: SessionsState, target: ResumePayload | null): string | null {
  if (target === null || 'mode' in target) return null;
  return sessionTitle(state, target.sessionId);
}
