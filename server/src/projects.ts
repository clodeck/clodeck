import type { FastifyInstance, FastifyReply } from 'fastify';

import type { CreateProjectResult, DeleteProjectResult, ProjectDiscovery } from './discovery.js';
import type { TerminalManager } from './terminal/manager.js';
import type { TurnManager } from './ws/turn-manager.js';

/**
 * The projects REST surface: the list, the one write that adds a project
 * (ticket 47), and the one that removes it for good (ticket 89). All are
 * registered together into the app's gated `/api` scope, so each is
 * authenticated by *where* it sits rather than by a rule of its own — the same
 * door the list already goes through.
 *
 * The two writes change the projects root, which is exactly the thing `ScopedFs`
 * refuses to touch (its own root is never a write target), so they live on the
 * discovery seam and this module only reads the request and maps the outcome.
 *
 * A delete additionally has to respect state the directory does not own: a run
 * writing a session, and a terminal holding a shell open. Those are asked of the
 * two managers here, before discovery is told to remove anything (decision 87,
 * D3) — an ordinary delete is refused while either is alive.
 */
export function registerProjectRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery; turns: TurnManager; terminals: TerminalManager },
): void {
  api.get('/projects', async () => ({ projects: await options.projects.listProjects() }));

  api.post<{ Body: unknown }>('/projects', async (request, reply) => {
    const name = readName(request.body);
    if (name === null) return reply.code(400).send({ error: 'name must be a string' });

    return createOutcome(reply, await options.projects.createProject(name));
  });

  api.delete<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    // The id re-enters through the seam, exactly like every other project route;
    // decoding it is never authorization (wayfinder 05 §5). The resolved id is
    // the canonical path, which is what the two managers key their state by.
    const project = await options.projects.resolveProject(request.params.id);
    if (project === null) return reply.code(404).send({ error: 'not found' });

    // A run in flight keeps the directory: its own working tree is beneath it.
    // `isRunning`, never `runningSession` — a run that started but has not named
    // its session yet has no id and is still a run (decision 87, D3).
    if (options.turns.isRunning(project.id)) {
      return reply.code(409).send({ error: 'turn_in_progress' });
    }
    // Likewise a shell: clodeck does not close things on the user's behalf, and
    // the transport's owner map would be left holding a dead terminal (D3).
    if (options.terminals.has(project.id)) {
      return reply.code(409).send({ error: 'terminal_attached' });
    }

    const result = await options.projects.deleteProject(request.params.id);
    if (result.status === 'ok') {
      // The id is the canonical path, so a re-created project has the same id.
      // The old run entry must go with the directory, or its session id would
      // silently resume a conversation from a project that no longer exists
      // (decision 87, D9).
      options.turns.forgetProject(project.id);
    }

    return deleteOutcome(reply, result);
  });
}

/** A create request's `name`: a string, or `null` when it is absent or not one. */
function readName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const name = (body as Record<string, unknown>)['name'];
  return typeof name === 'string' ? name : null;
}

/**
 * Map a {@link CreateProjectResult} to a status code. `201` with the created
 * `Project` — the same shape `GET /projects` lists, so the client can select it
 * by id straight away. A name that is not one clean, non-dot segment is a `400`
 * (a syntax refusal, like the drawer's `invalid name`); an entry already at the
 * name is a `409`, the same code the file routes use for the same situation; and
 * a root that is not configured or not there is a `503` — a create has no honest
 * empty answer, unlike the list.
 */
function createOutcome(reply: FastifyReply, result: CreateProjectResult): FastifyReply {
  switch (result.status) {
    case 'ok':
      return reply.code(201).send({ project: result.project });
    case 'invalid_name':
      return reply
        .code(400)
        .send({ error: 'name must be a single path segment, and must not start with a dot' });
    case 'exists':
      return reply.code(409).send({ error: 'already exists' });
    case 'no_root':
      return reply.code(503).send({ error: 'no usable projects root is configured' });
  }
}

/**
 * Map a {@link DeleteProjectResult} to a status code (decision 87, D7): `204`
 * with no body when the directory is gone; `404` when the id names no project
 * that could be deleted — the root included; and `400 symlink` when the scan
 * refuses the entry, either because it is a link or because more than one root
 * entry names the same canonical path.
 */
function deleteOutcome(reply: FastifyReply, result: DeleteProjectResult): FastifyReply {
  switch (result.status) {
    case 'ok':
      return reply.code(204).send();
    case 'not_found':
      return reply.code(404).send({ error: 'not found' });
    case 'symlink':
      return reply.code(400).send({ error: 'symlink' });
  }
}
