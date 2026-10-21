import {
  DEFAULT_PROFILE,
  type ApprovalRequestPayload,
  type ApprovalResponsePayload,
  type Project,
  type ResumePayload,
  type SDKModelUsage,
} from '@clodeck/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Name } from '../Name';
import { useToast } from '../toast/ToastProvider';
import { ChatColumn } from './ChatColumn';
import { Composer } from './Composer';
import { EntryView, StreamingBubble, formatInput } from './EntryView';
import { PermissionModePicker } from './PermissionModePicker';
import { browserStorage, readRememberedProfile, rememberProfile } from './providerMemory';
import { ProviderPicker } from './ProviderPicker';
import { TURN_RUNNING } from './reasons';
import type { ChatView, TurnResult } from './reducer';
import { useCommands } from './useCommands';
import { SessionBrowser, TranscriptPanel, resumeTargetTitle, sessionTitle } from './SessionHistory';
import { useChat, type ChatConnection } from './useChat';
import { useProfiles } from './useProfiles';
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
 *
 * Since ticket 74 the header says *which* session this is and carries the door
 * out of it: `New chat` drops the chat — here and on the bus — so the next send
 * starts a session of its own, and the picker beside the composer is the reason
 * to want one.
 */

/** Why it is shut with no live socket: what it clears is the server's state. */
const NEW_CHAT_UNREACHABLE = 'the chat is not connected — starting a new one has to reach the server';

export function ChatPanel({ project }: { project: Project }): ReactElement {
  const {
    view,
    connection,
    sendPrompt,
    setPermissionMode,
    interrupt,
    respond,
    resume,
    newChat,
    dismissError,
  } = useChat(project);
  const sessions = useSessions(project);
  // Per project, not per app: the list is the deployment's, but which of it a
  // session may choose from is the project's — a project that pins its provider
  // is offered its tiers alone (ADR 0002).
  const profiles = useProfiles(project.id);
  const commands = useCommands(project.id);
  const toast = useToast();
  const [browserOpen, setBrowserOpen] = useState(false);

  /**
   * What `/` may offer: the **run's** list the moment it has one — it is the
   * authority on what this session can dispatch, and the only source that has
   * Claude Code's own commands, which no file declares — and the project's own
   * files until then, because before the first send there is no run to ask.
   *
   * The run's list is what answers after that, always: its list already contains
   * everything the files declare, so the two are not alternatives but stages.
   */
  const offeredCommands = view.commands.length > 0 ? view.commands : commands.commands;

  /**
   * The profile this session runs on. It opens on the one remembered for this
   * project, and on the server's own environment when nothing is remembered —
   * never on whatever the last session elsewhere chose (ticket 68's eighth
   * criterion). It is written back as it is chosen, so the *next* session in
   * this project does not have to be told again.
   */
  const [profile, setProfile] = useState(
    () => readRememberedProfile(browserStorage(), project.id) ?? DEFAULT_PROFILE,
  );

  /**
   * The lock is the server's own word for a session that has run — a session id
   * it named, or a turn it reports as running — rather than a client flag
   * flipped on send. A send that was refused (a stale profile name, say) never
   * started a run and must not shut the control the error tells the user to use.
   */
  const locked = view.sessionId !== null || view.state !== 'idle';

  /** A turn the project is in the middle of, parked approval included. */
  const running = view.state !== 'idle';
  /**
   * Why `New chat` cannot do its job: it throws a transcript away, so not while
   * one is being written — and it is the *server's* state it clears, so not
   * while there is nothing to clear it through. A shut control says why (the
   * rail's rule, ticket 57).
   */
  const newChatReason =
    running ? TURN_RUNNING : connection === 'live' ? undefined : NEW_CHAT_UNREACHABLE;

  const chooseProfile = (name: string): void => {
    setProfile(name);
    rememberProfile(browserStorage(), project.id, name);
  };

  /**
   * The session a running turn is writing: only its row's delete is shut. A
   * turn that has not named a session yet protects none, which is the ticket's
   * own rule — an older transcript is free (ticket 79).
   */
  const runningSessionId = running ? view.sessionId : null;

  /**
   * Delete one stored session, and take the live half with it when the two are
   * the same conversation. The reset is the existing `newChat` — the only act
   * that clears the run's buffer and the armed target on the server — so a
   * deleted session cannot be resumed by the next send (ticket 74's door, reused
   * rather than a second reset).
   */
  const deleteSession = async (sessionId: string): Promise<void> => {
    const title = sessionTitle(sessions.sessions, sessionId) ?? sessionId;
    await sessions.delete(sessionId);
    if (view.sessionId === sessionId || namesSession(view.resumeTarget, sessionId)) {
      newChat();
    }
    toast(`deleted ${title}`);
  };

  const approval = view.pendingApprovals[0];
  const viewingHistory = sessions.transcript.status !== 'closed';

  /**
   * The list was read when this panel mounted, which is *before* the session this
   * chat is now in existed — so the moment the run names one, it is asked again.
   * That is what makes the header's title the string History has rather than the
   * id it falls back to: the transcript the title is read from has only just been
   * written. Once per session, and not at all for a chat that has named none.
   */
  const { reload: reloadSessions } = sessions;
  useEffect(() => {
    if (view.sessionId !== null) reloadSessions();
  }, [view.sessionId, reloadSessions]);

  return (
    <section className="relative flex min-h-0 flex-col" aria-label="Chat">
      {/* On a phone the controls are wider than the header: wrapping keeps the
          identity and the three buttons reachable instead of pushing one of
          them past the edge. The desktop header has room and never wraps. */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Chat</h2>
          <ConnectionPill connection={connection} />
          <SessionIdentity
            sessionId={view.sessionId}
            title={sessionTitle(sessions.sessions, view.sessionId)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span title={newChatReason}>
            <button
              type="button"
              disabled={newChatReason !== undefined}
              title={newChatReason}
              onClick={() => {
                newChat();
                // The history surface goes with it: a new chat is not the one
                // whose transcript was open.
                sessions.close();
                setBrowserOpen(false);
              }}
              className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5 disabled:opacity-40"
            >
              New chat
            </button>
          </span>
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
          runningSessionId={runningSessionId}
          onReload={sessions.reload}
          onDelete={deleteSession}
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

      {/* The scroller is the full-bleed stage — the chat's background runs to
          its edges — and the band inside it is what is centred. */}
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <ChatColumn>
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
        </ChatColumn>
      </div>

      {/* The rule is the footer's and stays full-bleed; what the footer *says* —
          the resume banner, the live indicators, the result line, the error
          banner and the composer — is the same column the transcript is in. */}
      <footer className="shrink-0 border-t border-line py-2">
        <ChatColumn>
          <div className="flex flex-col gap-2">
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
            {/* Beside the composer, not in the header: the profile and the
                mode are what the *next* message runs on, so they belong where
                the message is typed — and they sit together because a send
                carries both. */}
            <div className="flex flex-wrap items-center gap-2">
              <ProviderPicker
                state={profiles.state}
                name={profile}
                locked={locked}
                onChoose={chooseProfile}
                onReload={profiles.reload}
              />
              <PermissionModePicker mode={view.permissionMode} onChoose={setPermissionMode} />
            </div>
            <Composer
              onSend={(prompt) => {
                sendPrompt(prompt, profile, view.permissionMode);
              }}
              disabled={connection !== 'live'}
              commands={offeredCommands}
              onMenuOpen={commands.reload}
            />
          </div>
        </ChatColumn>
      </footer>

      {approval !== undefined && <ApprovalDialog request={approval} onRespond={respond} />}
    </section>
  );
}

/**
 * Which session this chat is in, in the server's own words: the id rides the
 * envelope of every event, so the identity does not depend on which block a
 * surface happened to fold — the reducer reads it straight into `view.sessionId`.
 *
 * The name is the title History lists for that id: **one** source, so the two
 * surfaces cannot spell the same session differently, and the id goes in the
 * tooltip beside it because a title is not unique and an id is. A chat that has
 * sent nothing has no session to be in, and says so rather than naming one.
 */
function SessionIdentity({
  sessionId,
  title,
}: {
  sessionId: string | null;
  title: string | null;
}): ReactElement {
  if (sessionId === null) return <span className="text-[11px] text-ink-dim">new chat</span>;

  return (
    <span
      className="truncate text-[11px] text-ink-dim"
      title={title === null ? sessionId : `${title} · ${sessionId}`}
    >
      <Name>{title ?? sessionId}</Name>
    </span>
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

/** Whether a resume target names `sessionId` — `continue` names none. */
function namesSession(target: ResumePayload | null, sessionId: string): boolean {
  return target !== null && 'sessionId' in target && target.sessionId === sessionId;
}

/**
 * Says what the next message will continue, so a resumed send is never a
 * surprise. The way out is `New chat` in the header — it drops the target here
 * and on the bus (ticket 74) — rather than a Cancel on the banner, because
 * dropping the target alone would leave the transcript of the session it names
 * still on screen.
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
  const usage = tokenTotals(result.modelUsage);
  return (
    <div className={`flex items-center gap-3 text-[11px] ${result.isError ? 'text-err' : 'text-ink-dim'}`}>
      <p title={usage.title}>
        {result.isError ? `Turn failed (${result.subtype})` : 'Turn complete'}
        {/* Cumulative for the session, so it is labelled as the session's. */}
        {usage.text !== null && ` · session ${usage.text}`}
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

/**
 * The result line's token segment. `modelUsage` is per model and cumulative for
 * the session — a resumed session's first result already carries its earlier
 * turns — so the line sums the models and the tooltip keeps the split. These
 * numbers replace `total_cost_usd`, which is a client-side estimate priced at
 * Claude's list rates and can be many times the real bill on another endpoint
 * (`.scratch/clodeck/research/01-token-cost.md` §3).
 */
function tokenTotals(modelUsage: Readonly<Record<string, SDKModelUsage>>): {
  text: string | null;
  title: string | undefined;
} {
  const models = Object.entries(modelUsage);
  if (models.length === 0) return { text: null, title: undefined };

  const totals = models.reduce(
    (sum, [, usage]) => ({
      input: sum.input + usage.inputTokens,
      cacheRead: sum.cacheRead + usage.cacheReadInputTokens,
      cacheWrite: sum.cacheWrite + usage.cacheCreationInputTokens,
      output: sum.output + usage.outputTokens,
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  );

  const text = [
    `${formatTokens(totals.input)} in`,
    `${formatTokens(totals.cacheRead)} cached`,
    ...(totals.cacheWrite > 0 ? [`${formatTokens(totals.cacheWrite)} cache write`] : []),
    `${formatTokens(totals.output)} out`,
  ].join(' · ');

  // One line per model, so a subagent's share is not hidden inside the sum.
  const title = models
    .map(
      ([model, usage]) =>
        `${model}: ${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.cacheReadInputTokens)} cache read · ${formatTokens(usage.cacheCreationInputTokens)} cache write · ${formatTokens(usage.outputTokens)} out`,
    )
    .join('\n');

  return { text, title };
}

/** Exact counts with separators: these are the numbers a bill is checked against. */
function formatTokens(count: number): string {
  return count.toLocaleString('en-US');
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
    case 'unknown_profile':
      // The one refusal the user can act on: nothing ran, and the profile they
      // asked for is the thing to change. The message names it.
      return 'That profile is not available';
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
/* Connection state                                                           */
/* -------------------------------------------------------------------------- */

function ConnectionPill({ connection }: { connection: ChatConnection }): ReactElement {
  const label = connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  const tone = connection === 'live' ? 'text-accent' : 'text-ink-dim';
  return <span className={`text-[11px] ${tone}`}>{label}</span>;
}
