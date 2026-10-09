import type { ApprovalRequestPayload, ApprovalResponsePayload, Project, ResumePayload } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import { EntryView, formatInput } from './EntryView';
import type { ChatView, TurnResult } from './reducer';
import { SessionBrowser, TranscriptPanel, resumeTargetTitle } from './SessionHistory';
import { useChat, type ChatConnection } from './useChat';
import { useSessions } from './useSessions';

/**
 * The chat surface: the streaming transcript, a composer that sends
 * `send_prompt`, an interrupt affordance, and the approval modal. The renderer
 * follows the mapping in research 01 §3 verbatim — text streams into a live
 * bubble and is reconciled by the complete block, tools become cards with their
 * results collapsed underneath, subagent frames nest, and anything unknown is
 * dropped rather than crashing the render.
 *
 * Since ticket 11 it also carries history: a list of the project's past sessions
 * and the read-only transcript of one, both folded to the same view model and
 * rendered by the same `EntryView`. Opening a transcript never touches the live
 * socket, so a reload or a reconnect still has the run's own `snapshot` to
 * rebuild from.
 */
export function ChatPanel({ project }: { project: Project }): ReactElement {
  const { view, connection, sendPrompt, interrupt, respond, resume, dismissError } = useChat(project);
  const sessions = useSessions(project);
  const [browserOpen, setBrowserOpen] = useState(false);
  const approval = view.pendingApprovals[0];
  const viewingHistory = sessions.transcript.status !== 'closed';

  return (
    <section className="relative flex min-h-0 flex-col" aria-label="Chat">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Chat</h2>
          <ConnectionPill connection={connection} />
          {view.model !== null && (
            <span className="truncate font-mono text-[11px] text-ink-dim" title={view.model}>
              {view.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBrowserOpen((open) => !open);
            }}
            aria-expanded={browserOpen}
            className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
          >
            History
          </button>
          <button
            type="button"
            onClick={interrupt}
            disabled={view.state !== 'running'}
            className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5 disabled:opacity-40"
          >
            Interrupt
          </button>
        </div>
      </header>

      {browserOpen && (
        <SessionBrowser
          state={sessions.sessions}
          currentSessionId={view.sessionId}
          onReload={sessions.reload}
          onOpen={(sessionId) => {
            sessions.open(sessionId);
            setBrowserOpen(false);
          }}
          onResume={(target) => {
            // Only sets the target; the transcript returns to the live chat so
            // the user sees the resumed turn the next send produces.
            resume(target);
            sessions.close();
            setBrowserOpen(false);
          }}
          onClose={() => {
            setBrowserOpen(false);
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {viewingHistory ? (
          <TranscriptPanel
            state={sessions.transcript}
            onResume={(target) => {
              resume(target);
              sessions.close();
            }}
            onClose={sessions.close}
          />
        ) : (
          <LiveTranscript view={view} />
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-line px-4 py-2">
        {view.resumeTarget !== null && (
          <ResumeBanner target={view.resumeTarget} sessionTitle={resumeTargetTitle(sessions.sessions, view.resumeTarget)} />
        )}
        <LiveIndicators view={view} />
        {view.lastResult !== null && (
          <ResultLine
            result={view.lastResult}
            onResume={
              view.lastResult.canResume
                ? () => {
                    // Arms the next send to continue this session — or the latest
                    // one when the run never named a session. Like every resume it
                    // sends no prompt itself; the resumed turn starts on the send
                    // that follows (ticket 11).
                    resume(view.sessionId !== null ? { sessionId: view.sessionId } : { mode: 'continue' });
                  }
                : null
            }
          />
        )}
        {view.lastError !== null && (
          <ErrorBanner code={view.lastError.code} message={view.lastError.message} onDismiss={dismissError} />
        )}
        <Composer onSend={sendPrompt} disabled={connection !== 'live'} />
      </footer>

      {approval !== undefined && <ApprovalDialog request={approval} onRespond={respond} />}
    </section>
  );
}

/** The live chat body — the entries the socket has folded so far, plus the streaming bubble. */
function LiveTranscript({ view }: { view: ChatView }): ReactElement {
  return (
    <>
      {view.entries.length === 0 && view.streamingText === '' ? <EmptyChat /> : null}
      <ol className="flex flex-col gap-3">
        {view.entries.map((entry, index) => (
          <li key={index}>
            <EntryView entry={entry} />
          </li>
        ))}
      </ol>
      {view.streamingText !== '' && <StreamingBubble text={view.streamingText} />}
    </>
  );
}

/**
 * Says what the next message will continue, so a resumed send is never a
 * surprise. There is no cancel: the protocol carries no "clear the target"
 * message, so the only way to drop it is to send and let it be consumed.
 */
function ResumeBanner({ target, sessionTitle }: { target: ResumePayload; sessionTitle: string | null }): ReactElement {
  const continuing = 'mode' in target;
  const label = continuing ? 'the most recent session' : (sessionTitle ?? target.sessionId);
  const forked = !continuing && target.fork === true;

  return (
    <p className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] text-ink" role="status">
      The next message continues <span className="font-semibold text-accent">{label}</span>
      {forked && ' in a new fork'}.
    </p>
  );
}

function StreamingBubble({ text }: { text: string }): ReactElement {
  return (
    <p className="mt-3 text-sm whitespace-pre-wrap text-ink">
      {text}
      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
    </p>
  );
}

function EmptyChat(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-ink-dim">Send a prompt to start the session.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live indicators, result, errors                                            */
/* -------------------------------------------------------------------------- */

function LiveIndicators({ view }: { view: ChatView }): ReactElement | null {
  const live =
    view.progress ??
    (view.streamingTool === null ? null : { toolName: view.streamingTool.name, elapsedSeconds: null });
  if (live === null && view.status === null) return null;

  return (
    <div className="flex items-center gap-3 text-[11px] text-ink-dim" role="status">
      {live !== null && (
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Using {live.toolName}…
          {live.elapsedSeconds !== null && ` (${String(live.elapsedSeconds)}s)`}
        </span>
      )}
      {view.status !== null && <span className="text-ink-dim">{view.status}…</span>}
    </div>
  );
}

function ResultLine({ result, onResume }: { result: TurnResult; onResume: (() => void) | null }): ReactElement {
  return (
    <div className={`flex items-center gap-3 text-[11px] ${result.isError ? 'text-err' : 'text-ink-dim'}`}>
      <p>
        {result.isError ? `Turn failed (${result.subtype})` : 'Turn complete'} · ${result.costUsd.toFixed(4)}
        {result.stopReason !== null && ` · ${result.stopReason}`}
      </p>
      {onResume !== null && (
        <button
          type="button"
          onClick={onResume}
          className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
        >
          Resume
        </button>
      )}
    </div>
  );
}

function ErrorBanner({ code, message, onDismiss }: { code: string; message: string; onDismiss: () => void }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-err/40 bg-err/10 px-3 py-2" role="alert">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-err">{errorTitle(code)}</p>
        <p className="mt-0.5 font-mono text-[11px] break-words text-ink-dim">
          {code}: {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}

/** The bus's error codes, in the user's terms (server/src/ws/bus.ts). */
function errorTitle(code: string): string {
  switch (code) {
    case 'turn_in_progress':
      return 'A turn is already running';
    case 'unknown_project':
      return 'This project is no longer available';
    case 'invalid_message':
      return 'The message was rejected';
    case 'no_active_turn':
      return 'No turn is running';
    default:
      return 'Something went wrong';
  }
}

/* -------------------------------------------------------------------------- */
/* Approval modal                                                             */
/* -------------------------------------------------------------------------- */

function ApprovalDialog({
  request,
  onRespond,
}: {
  request: ApprovalRequestPayload;
  onRespond: (response: ApprovalResponsePayload) => void;
}): ReactElement {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/80 p-4">
      <div role="dialog" aria-modal="true" aria-label="Permission requested" className="w-full max-w-lg rounded-lg border border-line bg-panel p-5">
        <p className="text-[11px] tracking-wider text-ink-dim uppercase">Permission requested</p>
        <h3 className="mt-1 text-sm font-semibold text-ink">
          {request.title ?? `Claude wants to use ${request.toolName}`}
        </h3>
        {request.displayName !== undefined && <p className="mt-0.5 text-xs text-accent">{request.displayName}</p>}
        {request.description !== undefined && <p className="mt-2 text-sm text-ink-dim">{request.description}</p>}

        <pre className="mt-3 max-h-48 overflow-auto rounded border border-line bg-canvas p-3 font-mono text-[11px] whitespace-pre-wrap text-ink">
          {formatInput(request.input)}
        </pre>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onRespond({ requestId: request.requestId, behavior: 'deny', message: 'The user denied this tool call.' });
            }}
            className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-white/5"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => {
              onRespond({ requestId: request.requestId, behavior: 'allow' });
            }}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

function Composer({ onSend, disabled }: { onSend: (prompt: string) => void; disabled: boolean }): ReactElement {
  const [value, setValue] = useState('');
  const canSend = value.trim() !== '' && !disabled;

  const submit = (): void => {
    if (!canSend) return;
    onSend(value);
    setValue('');
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2"
    >
      <textarea
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          // Enter sends; Shift+Enter is a newline.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={disabled ? 'Connecting…' : 'Ask Claude…'}
        aria-label="Message"
        className="min-h-0 flex-1 resize-none rounded border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={!canSend}
        className="rounded bg-accent px-3 py-2 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}

function ConnectionPill({ connection }: { connection: ChatConnection }): ReactElement {
  const label = connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  const tone = connection === 'live' ? 'text-accent' : 'text-ink-dim';
  return <span className={`text-[11px] ${tone}`}>{label}</span>;
}
