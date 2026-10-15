import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import { PROTOCOL_VERSION, type ServerEvent } from '@clodeck/shared';

import { installWebSocketGuards, type AuthOptions } from '../auth/transport.js';
import type { ProjectDiscovery } from '../discovery.js';
import { createScopedFs } from '../files/scoped-fs.js';
import { applyPin, UnknownProfileError, type ProviderProfiles, type RunProfile } from '../profiles.js';
import { readProjectPin } from '../project-pin.js';
import { parseClientMessage } from './client-message.js';
import type { EmitDraft, EventDraft } from './events.js';
import { WS_OPEN, textOf } from './frames.js';
import type { TurnManager } from './turn-manager.js';

/**
 * The `/ws` event bus (spec-02 §"The `/ws` event bus"): one connection is bound
 * to one project by `?projectId=`, because the control messages carry no project
 * of their own. It is registered on the same Fastify instance `buildApp`
 * returns, so `main.ts` and the tests reach it with no separate server.
 *
 * Two checks front the upgrade, both before a socket exists (spec-05 §"Routes +
 * the gate"): the handshake's `Origin` must be same-origin when it carries one,
 * and the session cookie must name a live session. Only then is the
 * client-supplied id re-validated through the discovery seam (wayfinder 05 §5);
 * a rejected id is closed, never opened.
 */

export function registerWsBus(
  app: FastifyInstance,
  options: {
    projects: ProjectDiscovery;
    turns: TurnManager;
    /**
     * The boot-time profile list a `send_prompt` names one from. The name is
     * resolved here, and then narrowed by whatever the project itself pins
     * (`profiles.ts`'s `applyPin`).
     */
    profiles: ProviderProfiles;
    auth: AuthOptions;
  },
): void {
  // `@fastify/websocket` is registered once in the app root (see `app.ts`); its
  // `websocket: true` handling is an `onRoute` hook, so it has already loaded by
  // the time this route is added. The route lives in its own plugin, like the
  // sibling `/ws/terminal`, so both register their routes in the same shape.
  app.register(async (bus) => {
    installWebSocketGuards(bus, options.auth);

    bus.get('/ws', { websocket: true }, (socket, request) => {
      void openConnection(socket, request, options);
    });
  });
}

async function openConnection(
  socket: WebSocket,
  request: FastifyRequest,
  options: { projects: ProjectDiscovery; turns: TurnManager; profiles: ProviderProfiles },
): Promise<void> {
  const emit = createEmitter(socket);

  // Resolving the id hits the filesystem, so a frame sent eagerly could arrive
  // before we are ready to read it. Buffer until the snapshot is out, because a
  // dropped control message is worse than a slightly late one.
  const buffered: unknown[] = [];
  // Frames are dispatched through one chain so they keep arrival order even
  // when a handler awaits (interrupt, set_permission_mode) — and a handler that
  // threw can never break the chain for the frames behind it.
  let drain: Promise<void> = Promise.resolve();
  let handle: (raw: unknown) => void = (raw) => {
    buffered.push(raw);
  };
  socket.on('message', (raw: unknown) => {
    handle(raw);
  });

  const projectId = readProjectId(request);
  const project = projectId === undefined ? null : await options.projects.resolveProject(projectId);

  if (project === null) {
    emit(errorDraft(projectId, 'unknown_project', 'no allowlisted project matches this id'));
    socket.close(1008, 'unknown_project');
    return;
  }

  emit(options.turns.snapshot(project.id));

  // Subscribed only after the snapshot, so no live event can precede it.
  socket.on('close', options.turns.subscribe(project.id, emit));

  const cwd = project.path;
  handle = (raw) => {
    drain = drain.then(() => dispatchFrame(raw, { projectId: project.id, cwd, options, emit }));
  };

  for (const raw of buffered.splice(0)) handle(raw);
}

async function dispatchFrame(
  raw: unknown,
  context: {
    projectId: string;
    cwd: string;
    options: { turns: TurnManager; profiles: ProviderProfiles };
    emit: EmitDraft;
  },
): Promise<void> {
  const intent = parseClientMessage(textOf(raw));
  if (intent === null) {
    context.emit(
      errorDraft(context.projectId, 'invalid_message', 'the frame was not a valid control message'),
    );
    return;
  }

  try {
    switch (intent.type) {
      case 'send_prompt':
        // The name is resolved here, before anything starts: an unknown one
        // throws, the run is never created, and the client is told which name it
        // asked for — never quietly given the default.
        context.options.turns.sendPrompt(
          context.projectId,
          context.cwd,
          intent.payload.prompt,
          await profileForRun(context.options.profiles, context.cwd, intent.payload.profile),
        );
        break;
      case 'interrupt':
        if (!(await context.options.turns.interrupt(context.projectId))) emitNoActiveTurn(context);
        break;
      case 'set_permission_mode':
        if (!(await context.options.turns.setPermissionMode(context.projectId, intent.mode))) {
          emitNoActiveTurn(context);
        }
        break;
      case 'approval_response':
        if (!context.options.turns.resolveApproval(context.projectId, intent.response)) {
          context.emit(
            errorDraft(
              context.projectId,
              'invalid_message',
              'no pending approval matches that requestId',
            ),
          );
        }
        break;
      case 'resume':
        // No prompt here: the target is consumed by the send that follows.
        context.options.turns.setResumeTarget(context.projectId, intent.target);
        break;
    }
  } catch (error) {
    // A stale name is the one failure the user can act on, so it is reported as
    // itself — with the name they asked for — rather than as a generic failure.
    if (error instanceof UnknownProfileError) {
      context.emit(errorDraft(context.projectId, 'unknown_profile', error.message));
      return;
    }
    // One control message failing must not break the chain for the frames behind it.
    context.emit(errorDraft(context.projectId, 'internal', 'the control message failed'));
  }
}

/**
 * The profile a `send_prompt` will run on: the name resolved against the boot-time
 * list, then narrowed by whatever the project pins in its own
 * `.claude/settings.json` (ADR 0002).
 *
 * The pin is read here, per send, through the project's own `ScopedFs`: the file
 * is the user's, they can edit it in the drawer, and a turn that starts after such
 * an edit has to honour it — a cached answer would be a rule applied to a project
 * as it used to be. The name is resolved first, so a stale one is refused without
 * touching a disk.
 */
async function profileForRun(
  profiles: ProviderProfiles,
  cwd: string,
  name: string | undefined,
): Promise<RunProfile> {
  const profile = profiles.resolve(name);
  return applyPin(profile, await readProjectPin(createScopedFs(cwd)));
}

function emitNoActiveTurn(context: { projectId: string; emit: EmitDraft }): void {
  context.emit(errorDraft(context.projectId, 'no_active_turn', 'no turn is running'));
}

/** Seq counts frames on *this* connection, so it starts at 1 and resets on reconnect. */
function createEmitter(socket: WebSocket): EmitDraft {
  let seq = 0;

  return (draft) => {
    if (socket.readyState !== WS_OPEN) return;
    seq += 1;
    const event: ServerEvent = { ...draft, seq, ts: new Date().toISOString() };
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // A socket that closed mid-send must not take the turn down with it.
    }
  };
}

function errorDraft(projectId: string | undefined, code: string, message: string): EventDraft {
  return {
    v: PROTOCOL_VERSION,
    ...(projectId !== undefined ? { projectId } : {}),
    kind: 'error',
    payload: { code, message },
  };
}

function readProjectId(request: FastifyRequest): string | undefined {
  const query: unknown = request.query;
  if (typeof query !== 'object' || query === null) return undefined;
  const value = (query as Record<string, unknown>)['projectId'];
  return typeof value === 'string' ? value : undefined;
}
