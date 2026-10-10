import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import type { ProjectDiscovery } from '../discovery.js';
import { WS_OPEN, textOf } from '../ws/frames.js';
import type { TerminalManager } from './manager.js';
import type { TerminalSize } from './pty.js';

/**
 * The `/ws/terminal` transport and its resize endpoint (spec-03 §"The
 * `/ws/terminal` route", §"Resize") — the raw-byte sibling of the `/ws` bus.
 *
 * It is registered on the same Fastify instance `buildApp` returns, and its
 * channel carries bytes, not the JSON envelope: client input goes straight to
 * the shell, shell output straight to the socket. `protocol.ts` is not involved.
 *
 * Security is the same seam as `/ws`: the client-supplied `projectId` is
 * re-validated through `resolveProject` (the allowlist) *before* any process
 * exists, so a non-allowlisted id is closed rather than turned into a shell. The
 * resolved project's path is the shell's `cwd` — a convenience (relative paths
 * just work), not a sandbox; the shell may still `cd` anywhere.
 */

/** The close code for a rejected, unauthenticated id — WebSocket policy violation. */
const POLICY_VIOLATION = 1008;

/** A normal closure, used when the shell's life is what ended the connection. */
const NORMAL_CLOSE = 1000;

/**
 * The size a shell starts at. The client's xterm knows its real size and posts
 * it to the resize endpoint as soon as it mounts (ticket 14), so the opening
 * spawn only needs a sane default.
 */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Register `/ws/terminal` as a sibling of `/ws`. `@fastify/websocket` is
 * registered once in the app root (its `websocket: true` handling is an
 * `onRoute` hook, so it must load before any route that uses it); this module
 * only adds the route.
 */
export function registerTerminalSocket(
  app: FastifyInstance,
  options: { projects: ProjectDiscovery; terminals: TerminalManager },
): void {
  /**
   * The connection that currently owns each project's shell. The manager keeps
   * one shell per project and `open` *replaces* it, so an older socket can stay
   * connected after its shell was killed. This map is the route's memory of who
   * that shell belongs to: only the owner may write to it or close it, and a
   * stale socket is inert rather than a way to hijack or reap a newer shell.
   */
  const owners = new Map<string, WebSocket>();

  // A shell that ends on its own closes the socket that owns it. The manager
  // reports only the *current* handle's exit, so the owner found here is the
  // connection whose shell it was.
  options.terminals.onExit((projectId) => {
    const socket = owners.get(projectId);
    if (socket === undefined) return;
    owners.delete(projectId);
    closeQuietly(socket, NORMAL_CLOSE, 'terminal_exited');
  });

  app.register(async (terminal) => {
    terminal.get('/ws/terminal', { websocket: true }, (socket, request) => {
      void openTerminal(socket, request, options, owners);
    });
  });
}

async function openTerminal(
  socket: WebSocket,
  request: FastifyRequest,
  options: { projects: ProjectDiscovery; terminals: TerminalManager },
  owners: Map<string, WebSocket>,
): Promise<void> {
  const rawId = readProjectId(request);
  const project = rawId === undefined ? null : await options.projects.resolveProject(rawId);

  // Reject before a process exists: an id that is not allowlisted (or absent)
  // never becomes a directory and never becomes a shell.
  if (project === null) {
    closeQuietly(socket, POLICY_VIOLATION, 'unknown_project');
    return;
  }

  const projectId = project.id;

  // This socket becomes the owner, and `open` replaces (kills) any shell the
  // project already had — a reload is a fresh shell, never a reused half-dead
  // one. Claiming ownership *before* opening means a replaced socket that is
  // still open can no longer act on the new shell.
  owners.set(projectId, socket);
  options.terminals.open(projectId, {
    cwd: project.path,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    onData: (data) => {
      // Output belongs to the live shell's owner; a replaced socket's sink is
      // already detached by the manager, but guard the send all the same.
      if (owners.get(projectId) !== socket) return;
      sendQuietly(socket, data);
    },
  });

  socket.on('message', (raw) => {
    // A stale socket must not feed bytes to the newer shell.
    if (owners.get(projectId) !== socket) return;
    options.terminals.write(projectId, textOf(raw));
  });

  socket.on('close', () => {
    // Only the owner may close the shell: a stale socket whose shell was already
    // replaced must not kill its successor's live shell.
    if (owners.get(projectId) !== socket) return;
    owners.delete(projectId);
    options.terminals.close(projectId);
  });
}

/**
 * Register `POST /projects/:id/terminal/size` inside the app's `/api` scope, so
 * it sits behind the same (future) auth hook as every other `/api` route. The
 * `:id` re-enters through `resolveProject` exactly like `sessions.ts`, and a
 * malformed body is refused before the terminal is consulted.
 */
export function registerTerminalSizeRoute(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery; terminals: TerminalManager },
): void {
  api.post<{ Params: { id: string }; Body: unknown }>(
    '/projects/:id/terminal/size',
    async (request, reply) => {
      const project = await options.projects.resolveProject(request.params.id);
      if (project === null) return notFound(reply, 'no allowlisted project matches this id');

      const size = readSize(request.body);
      if (size === null) {
        return reply.code(400).send({ error: 'cols and rows must be positive integers' });
      }

      if (!options.terminals.resize(project.id, size)) {
        return notFound(reply, 'no terminal is open for this project');
      }

      return reply.code(200).send({ ok: true });
    },
  );
}

/** The server's REST error shape — one envelope, no second kind (as in `sessions.ts`). */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ error: message });
}

function readSize(body: unknown): TerminalSize | null {
  if (typeof body !== 'object' || body === null) return null;
  const { cols, rows } = body as Record<string, unknown>;
  if (!isPositiveInt(cols) || !isPositiveInt(rows)) return null;
  return { cols, rows };
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Send only on an OPEN socket: a socket that closed mid-send must not throw. */
function sendQuietly(socket: WebSocket, data: string): void {
  if (socket.readyState !== WS_OPEN) return;
  try {
    socket.send(data);
  } catch {
    // A socket that is closing must not take the shell's transport down.
  }
}

/** Close only if the handshake is not already over; a second close would throw. */
function closeQuietly(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState !== WS_OPEN) return;
  try {
    socket.close(code, reason);
  } catch {
    // Already closing/closed — nothing to do, and no exception to leak.
  }
}

function readProjectId(request: FastifyRequest): string | undefined {
  const query: unknown = request.query;
  if (typeof query !== 'object' || query === null) return undefined;
  const value = (query as Record<string, unknown>)['projectId'];
  return typeof value === 'string' ? value : undefined;
}
