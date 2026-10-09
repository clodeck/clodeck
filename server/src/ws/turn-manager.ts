import { randomUUID } from 'node:crypto';

import {
  PROTOCOL_VERSION,
  type ApprovalRequestPayload,
  type ApprovalResponsePayload,
  type PermissionMode,
  type ProtocolVersion,
  type ResumePayload,
  type SDKMessage,
  type SessionState,
} from '@clodeck/shared';

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
  /** Start a turn on an idle project. */
  sendPrompt(projectId: string, cwd: string, prompt: string): void;
  /** Interrupt the active run. False when the project has no active turn. */
  interrupt(projectId: string): Promise<boolean>;
  /** Change the active run's permission mode. False when there is no active turn. */
  setPermissionMode(projectId: string, mode: PermissionMode): Promise<boolean>;
  /** Resolve a parked approval. False when no pending request matches the id. */
  resolveApproval(projectId: string, response: ApprovalResponsePayload): boolean;
  /** Set the target the next `sendPrompt` resumes from. The next send consumes it. */
  setResumeTarget(projectId: string, target: ResumePayload): void;
}

export function createTurnManager(provider: SdkProvider): TurnManager {
  const projects = new Map<string, ProjectRun>();

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
    };
    projects.set(projectId, created);
    return created;
  }

  return {
    snapshot(projectId) {
      const state = run(projectId);
      return {
        ...envelope(state),
        kind: 'snapshot',
        payload: {
          state: state.status,
          // Copies: a snapshot is a point in time, and the run keeps appending.
          blocks: [...state.blocks],
          pendingApprovals: [...state.pending.values()].map((entry) => entry.request),
          // `seq` is per connection and a fresh one has seen nothing.
          lastSeq: 0,
        },
      };
    },

    subscribe(projectId, emit) {
      const state = run(projectId);
      state.subscribers.add(emit);
      return () => {
        state.subscribers.delete(emit);
      };
    },

    sendPrompt(projectId, cwd, prompt) {
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

      state.status = 'running';
      state.turnId = randomUUID();
      broadcast(state, {
        ...envelope(state),
        kind: 'stream_status',
        payload: { status: 'turn_started' },
      });

      // The resume target applies to exactly one send.
      const target = state.resume;
      state.resume = undefined;

      let active: SdkRun;
      try {
        active = provider.query({
          cwd,
          prompt,
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
      void pump(state, active);
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
  };
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
async function pump(state: ProjectRun, active: SdkRun): Promise<void> {
  let ended = false;
  try {
    for await (const message of active.messages) {
      const sessionId = sessionIdOf(message);
      if (sessionId !== undefined) state.sessionId = sessionId;
      if (message.type !== 'stream_event') state.blocks.push(message);
      broadcast(state, { ...envelope(state), kind: 'sdk', payload: message });

      if (message.type === 'result') {
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
}
