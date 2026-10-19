import { randomUUID } from 'node:crypto';

import {
  PROTOCOL_VERSION,
  type ApprovalRequestPayload,
  type ApprovalResponsePayload,
  type PermissionMode,
  type ProtocolVersion,
  type ResolvedProvider,
  type ResumePayload,
  type SDKMessage,
  type SessionState,
  type SlashCommand,
} from '@clodeck/shared';

import { logToConsole, type Log } from '../logging.js';
import type { RunProfile } from '../profiles.js';
import type { ProjectPin } from '../project-pin.js';
import type { SdkProvider, SdkRun } from '../sdk/provider.js';
import type { EmitDraft, EventDraft } from './events.js';

/**
 * Per-project run state and turn lifecycle (spec-02 §"Turn lifecycle & control
 * messages"): the half of the bus that is about runs, kept apart from the socket
 * plumbing. State lives in memory, keyed by projectId, so it survives a socket
 * reconnect within the process but not a restart.
 *
 * Two sockets bound to the same project share one `ProjectRun`: they see the
 * same blocks, state and pending approvals, and each receives every live event
 * through its own emitter (and therefore its own `seq`).
 */
export interface TurnManager {
  /** The draft a (re)connecting socket is sent before anything else. */
  snapshot(projectId: string): EventDraft;
  /** Attach a socket's emitter for live events; the returned function detaches it. */
  subscribe(projectId: string, emit: EmitDraft): () => void;
  /**
   * Start a turn on an idle project, on the provider the caller resolved. The
   * run carries the keys itself, so this is also where a turn's provider is
   * recorded: the line below is the only answer to "what did that turn run on"
   * that survives the turn — including when a project's pin narrowed it.
   */
  sendPrompt(projectId: string, cwd: string, prompt: string, profile: RunProfile): void;
  /** Interrupt the active run. False when the project has no active turn. */
  interrupt(projectId: string): Promise<boolean>;
  /** Change the active run's permission mode. False when there is no active turn. */
  setPermissionMode(projectId: string, mode: PermissionMode): Promise<boolean>;
  /** Resolve a parked approval. False when no pending request matches the id. */
  resolveApproval(projectId: string, response: ApprovalResponsePayload): boolean;
  /** Set the target the next `sendPrompt` resumes from. The next send consumes it. */
  setResumeTarget(projectId: string, target: ResumePayload): void;
  /**
   * The session the project's *active* turn is writing, or `undefined` when no
   * turn is in flight — including a run that has started but not yet named a
   * session, which is the window in which an older session is free to delete.
   *
   * It is the one fact a session delete needs from the live half: a transcript
   * being written must not be removed underneath its run (ticket 79).
   */
  runningSession(projectId: string): string | undefined;
  /**
   * Drop what the run has accumulated *for the next send to read*: the armed
   * resume target, the buffered turn's blocks, and the session id those blocks
   * belong to. What is left is a project with nothing to continue and nothing to
   * replay, which is what makes the next `sendPrompt` a session of its own.
   *
   * A turn in flight is not this message's business: `status` and the parked
   * approvals belong to the live run, and clearing them here would let a second
   * send drive the model twice. Keeping a clear out of a running turn is the
   * surface's rule — the button is shut while one is in flight — the same
   * asymmetry `resume` has.
   *
   * The SDK discards a conversation on its own too, and reports it as
   * `conversation_reset`; both go through {@link forgetTranscript}.
   */
  clearResume(projectId: string): void;
}

export interface TurnManagerOptions {
  /** Where each run's profile and model are recorded. Defaults to the console. */
  log?: Log;
}

export function createTurnManager(provider: SdkProvider, options: TurnManagerOptions = {}): TurnManager {
  const projects = new Map<string, ProjectRun>();
  const log = options.log ?? logToConsole;

  function run(projectId: string): ProjectRun {
    const existing = projects.get(projectId);
    if (existing !== undefined) return existing;

    const created: ProjectRun = {
      id: projectId,
      status: 'idle',
      blocks: [],
      pending: new Map(),
      subscribers: new Set(),
      active: undefined,
      turnId: undefined,
      sessionId: undefined,
      resume: undefined,
      commands: undefined,
    };
    projects.set(projectId, created);
    return created;
  }

  return {
    snapshot(projectId) {
      return snapshotOf(run(projectId));
    },

    subscribe(projectId, emit) {
      const state = run(projectId);
      state.subscribers.add(emit);
      return () => {
        state.subscribers.delete(emit);
      };
    },

    sendPrompt(projectId, cwd, prompt, profile) {
      const state = run(projectId);
      // A second send would drive the model twice; the turn in flight owns the
      // project until it ends.
      if (state.status !== 'idle') {
        broadcast(state, {
          ...envelope(state),
          kind: 'error',
          payload: { code: 'turn_in_progress', message: 'a turn is already running' },
        });
        return;
      }

      // Recorded as the run starts, and only now: a send the busy check above
      // turned away ran nothing, and a line for it would answer "what did that
      // turn run on" about a turn that never was.
      log(`turn on profile ${profile.name} · ${describeRun(profile)} · ${cwd}`);

      state.status = 'running';
      state.turnId = randomUUID();
      broadcast(state, {
        ...envelope(state),
        kind: 'stream_status',
        payload: { status: 'turn_started' },
      });

      // The resume target applies to exactly one send. With none armed, the
      // send continues the session this run already has: a chat is one
      // conversation, so a follow-up keeps the context the last turn built
      // instead of starting over (and re-exploring it). `clear_resume` drops
      // the session id with the transcript, so a new chat still starts fresh,
      // and an explicitly armed target (History, a resume button) still wins.
      const target =
        state.resume ??
        (state.sessionId === undefined ? undefined : { sessionId: state.sessionId });
      state.resume = undefined;

      let active: SdkRun;
      try {
        active = provider.query({
          cwd,
          prompt,
          // The keys the run carries, not the name: an operator renaming or
          // removing a profile mid-turn cannot move it, and a project's pin has
          // already had its say (`applyPin`). `null` sends no keys at all, so
          // `Options.env` stays unset and the project's own environment decides
          // everything — which is what a pin that named no model asked for.
          ...(profile.sent === null ? {} : { provider: profile.sent }),
          ...resumeInput(target),
          // Gated tools come back through the callback the whole stack shares.
          canUseTool: (request) => park(state, request),
        });
      } catch (error) {
        // A query that cannot start must not leave the project wedged as
        // running; the frame's own handler reports the failure.
        state.status = 'idle';
        state.turnId = undefined;
        throw error;
      }

      state.active = active;
      void pump(state, active, log);
      // The run's own list of what it can dispatch, asked for once as it starts
      // (the SDK announces a list only when it *changes*, which a fresh session
      // has not). Fire-and-forget: it is a menu, not the turn.
      void listCommands(state, active);
    },

    async interrupt(projectId) {
      const state = run(projectId);
      if (state.active === undefined) return false;

      await state.active.interrupt();
      broadcast(state, {
        ...envelope(state),
        kind: 'stream_status',
        payload: { status: 'interrupted' },
      });
      return true;
    },

    async setPermissionMode(projectId, mode) {
      const state = run(projectId);
      if (state.active === undefined) return false;

      await state.active.setPermissionMode(mode);
      return true;
    },

    resolveApproval(projectId, response) {
      const state = run(projectId);
      const entry = state.pending.get(response.requestId);
      if (entry === undefined) return false;

      state.pending.delete(response.requestId);
      // The turn carries on once the tool is answered; with no run it is over.
      if (state.status === 'requires_action') {
        state.status = state.active === undefined ? 'idle' : 'running';
      }
      entry.resolve(response);
      return true;
    },

    setResumeTarget(projectId, target) {
      run(projectId).resume = target;
    },

    runningSession(projectId) {
      // `active` rather than `status`: a run is active from the moment it was
      // created until `pump`'s finally clears it, and after it ends the buffer's
      // session id is still there — but that turn is over, and its transcript is
      // nobody's to protect any more.
      const state = projects.get(projectId);
      return state?.active === undefined ? undefined : state.sessionId;
    },

    clearResume(projectId) {
      forgetTranscript(run(projectId), undefined);
    },
  };
}

/**
 * The run forgets what it had buffered — the turn's blocks, the session they
 * belong to, the target a send would have resumed, and the command list that
 * session reported — and every socket is handed the snapshot that results.
 *
 * One act with two callers, which is why it is one function: the client asks for
 * it (`clear_resume`, the header's `New chat`) and the SDK reports that it has
 * already happened (`conversation_reset` — `/clear`, a plan-mode exit, a flow of
 * its own). A second spelling of it would be a second answer to what a project's
 * buffer holds, and the two would drift.
 *
 * `sessionId` is what the conversation became. `undefined` for a client-asked
 * clear, which creates nothing — the next send is the session, and names itself.
 * For the SDK's own reset it is the `new_conversation_id` the frame announces,
 * because that frame *is* the run's word for the identity it moved to.
 */
function forgetTranscript(state: ProjectRun, sessionId: string | undefined): void {
  state.resume = undefined;
  // The buffer and the identity go together, because they are one thing: the
  // run's own transcript and the session it belongs to. Clearing the blocks
  // alone would leave the next envelope — and so the next snapshot — naming a
  // session whose transcript is no longer here.
  state.blocks.length = 0;
  state.sessionId = sessionId;
  // The command list is the same kind of thing: what *this* session reported,
  // and the next one will report its own. Kept, it would be a new chat whose
  // menu still describes the session it left.
  state.commands = undefined;

  // Answered to every socket on the project, not only the one that asked: the
  // run is the project's, so a second tab is looking at the same chat and would
  // otherwise keep showing one that no longer exists.
  broadcast(state, snapshotOf(state));
}

/** The draft a socket is sent to learn the run's whole state: on (re)connect, and after a clear. */
function snapshotOf(state: ProjectRun): EventDraft {
  return {
    ...envelope(state),
    kind: 'snapshot',
    payload: {
      state: state.status,
      // Copies: a snapshot is a point in time, and the run keeps appending.
      blocks: [...state.blocks],
      pendingApprovals: [...state.pending.values()].map((entry) => entry.request),
      // Absent while the run has listed nothing — the state every connection
      // opens in, and every project is in until a session has started.
      ...(state.commands === undefined ? {} : { commands: [...state.commands] }),
      // `seq` is per connection and a fresh one has seen nothing.
      lastSeq: 0,
    },
  };
}

/**
 * Asks the run what it can dispatch, records it, and tells every socket.
 *
 * Two things can be true of the answer by the time it arrives, and neither is an
 * error: the run may have ended (a new one's list is the fresh one, and this
 * would land on top of it), or the provider may have refused. Both leave the
 * client with what it already had — the project's own files — because a menu
 * nobody could fill is not a turn's business.
 *
 * An **empty** answer is no answer: a session that lists no commands leaves the
 * client exactly where an unanswered one does, so there is nothing to send and
 * nothing to record. What arrives on the wire is therefore always a list.
 */
async function listCommands(state: ProjectRun, active: SdkRun): Promise<void> {
  let commands: readonly SlashCommand[];
  try {
    commands = await active.supportedCommands();
  } catch {
    return;
  }
  if (state.active !== active || commands.length === 0) return;

  state.commands = commands;
  broadcast(state, { ...envelope(state), kind: 'commands', payload: { commands } });
}

/**
 * What the run's environment carries from clodeck, and what the project's pin kept
 * instead.
 *
 * Two halves, because a choice and its outcome stopped being one thing the moment
 * a project could pin a provider: a line naming only the profile would report a
 * provider the turn never used. The model is named by value — it is the half a
 * reader can act on — and the endpoint and the credential only by name, so the
 * record of every turn is not a place this server writes a secret down.
 */
function describeRun(profile: RunProfile): string {
  const parts = [
    `model ${profile.sent?.model ?? 'the endpoint decides'}`,
    `sent: ${sentKeyNames(profile.sent)}`,
  ];

  const kept = keptKeyNames(profile.pin);
  if (kept.length > 0) parts.push(`kept by the project's pin: ${kept.join(', ')}`);

  return parts.join(' · ');
}

/** The provider keys a run carries, named the ADR's way. `nothing` when it carries none. */
function sentKeyNames(provider: ResolvedProvider | null): string {
  if (provider === null) return 'nothing';

  const names: string[] = [];
  if (provider.baseUrl !== undefined) names.push('endpoint');
  if (provider.authToken !== undefined) names.push('credential');
  if (provider.model !== undefined) names.push('model');
  return names.length === 0 ? 'nothing' : names.join(', ');
}

/** The keys a pinned project keeps. Never the model: the model travels free (ADR 0002). */
function keptKeyNames(pin: ProjectPin | null): string[] {
  if (pin === null) return [];

  const names: string[] = [];
  if (pin.baseUrl !== undefined) names.push('endpoint');
  if (pin.authToken !== undefined) names.push('credential');
  return names;
}

/**
 * The result's own token totals, one line per turn for the operator. It reads
 * `modelUsage`, never `total_cost_usd`: the dollar field is a client-side
 * estimate priced at Claude's list rates, and on a non-Claude endpoint it can be
 * many times the real bill (`.scratch/clodeck/research/01-token-cost.md` §3).
 *
 * The totals are the session's, not the turn's: a resumed session's first
 * result already carries its earlier turns, so the line grows across a chat.
 */
function describeResultUsage(result: Extract<SDKMessage, { type: 'result' }>): string {
  const models = Object.entries(result.modelUsage ?? {});
  if (models.length === 0) return 'session tokens · none reported';

  const parts = models.map(
    ([model, usage]) =>
      `${model} in ${usage.inputTokens} · cache read ${usage.cacheReadInputTokens} · cache write ${usage.cacheCreationInputTokens} · out ${usage.outputTokens}`,
  );
  return `session tokens · ${parts.join(' · ')}`;
}

/** The protocol's resume payload, as the provider's input fields. */
function resumeInput(target: ResumePayload | undefined): {
  continueLatest?: boolean;
  resume?: string;
  forkSession?: boolean;
} {
  if (target === undefined) return {};
  if ('mode' in target) return { continueLatest: true };
  return {
    resume: target.sessionId,
    ...(target.fork !== undefined ? { forkSession: target.fork } : {}),
  };
}

/** Emits `approval_request` and parks the run until `resolveApproval` answers it. */
function park(state: ProjectRun, request: ApprovalRequestPayload): Promise<ApprovalResponsePayload> {
  state.status = 'requires_action';
  return new Promise((resolve) => {
    state.pending.set(request.requestId, { request, resolve });
    broadcast(state, { ...envelope(state), kind: 'approval_request', payload: request });
  });
}

/** Reads the run's messages in order, forwarding each as an `sdk` event. */
async function pump(state: ProjectRun, active: SdkRun, log: Log): Promise<void> {
  let ended = false;
  try {
    for await (const message of active.messages) {
      // The SDK discarded the conversation itself, mid-turn. The run moves to the
      // conversation the frame names first, so the frame goes out under the
      // identity it announces and never under the one it just dropped — and then
      // it goes out like any other message. A client folding the live stream
      // clears the transcript on this frame; the snapshot just broadcast is what a
      // reconnect rebuilds from instead, and the two say the same thing.
      if (message.type === 'conversation_reset') {
        forgetTranscript(state, message.new_conversation_id);
        broadcast(state, { ...envelope(state), kind: 'sdk', payload: message });
        continue;
      }

      const sessionId = sessionIdOf(message);
      if (sessionId !== undefined) state.sessionId = sessionId;
      if (message.type !== 'stream_event') state.blocks.push(message);
      broadcast(state, { ...envelope(state), kind: 'sdk', payload: message });

      if (message.type === 'result') {
        log(describeResultUsage(message));
        ended = true;
        broadcast(state, {
          ...envelope(state),
          kind: 'stream_status',
          payload: { status: 'turn_ended' },
        });
      }
    }
  } catch {
    // The SDK throws after an error result too; once the result landed the turn
    // is already closed, so only a throw before one is a real failure.
    if (!ended) {
      broadcast(state, {
        ...envelope(state),
        kind: 'error',
        payload: { code: 'internal', message: 'the turn failed' },
      });
    }
  } finally {
    state.active = undefined;
    state.turnId = undefined;
    state.status = 'idle';
    // A turn that ended can no longer act on an approval it never got answered.
    state.pending.clear();
  }
}

function broadcast(state: ProjectRun, draft: EventDraft): void {
  for (const emit of state.subscribers) emit(draft);
}

function envelope(state: ProjectRun): Envelope {
  const base: Envelope = { v: PROTOCOL_VERSION, projectId: state.id };
  if (state.sessionId !== undefined) base.sessionId = state.sessionId;
  if (state.turnId !== undefined) base.turnId = state.turnId;
  return base;
}

/** The session an SDK message names, if it names one — the init and result carry it first. */
function sessionIdOf(message: SDKMessage): string | undefined {
  if (!('session_id' in message)) return undefined;
  const sessionId = message.session_id;
  return typeof sessionId === 'string' ? sessionId : undefined;
}

interface Envelope {
  v: ProtocolVersion;
  projectId: string;
  sessionId?: string;
  turnId?: string;
}

interface PendingApproval {
  request: ApprovalRequestPayload;
  resolve: (response: ApprovalResponsePayload) => void;
}

interface ProjectRun {
  readonly id: string;
  status: SessionState;
  readonly blocks: SDKMessage[];
  readonly pending: Map<string, PendingApproval>;
  readonly subscribers: Set<EmitDraft>;
  active: SdkRun | undefined;
  turnId: string | undefined;
  sessionId: string | undefined;
  resume: ResumePayload | undefined;
  /**
   * The command list the run reported as it started, or undefined while none has
   * — which is also where a cleared chat goes back to. It is separate from
   * `blocks` because it never travelled as an SDK message: the list is a control
   * answer, and only a *change* to it is a message (`commands_changed`).
   */
  commands: readonly SlashCommand[] | undefined;
}
