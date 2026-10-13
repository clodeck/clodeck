import type { FastifyInstance, FastifyReply } from 'fastify';

import type { CreateProjectResult, ProjectDiscovery } from './discovery.js';

/**
 * The projects REST surface: the list, and the one write that adds a project
 * (ticket 47). Both are registered together into the app's gated `/api` scope,
 * so a create is authenticated by *where* it sits rather than by a rule of its
 * own — the same door the list already goes through.
 *
 * The create writes one directory under the projects root, which is exactly the
 * thing `ScopedFs` refuses to touch (its own root is never a write target), so
 * the write itself lives on the discovery seam and this module only reads the
 * request and maps the outcome.
 */
export function registerProjectRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery },
): void {
  api.get('/projects', async () => ({ projects: await options.projects.listProjects() }));

  api.post<{ Body: unknown }>('/projects', async (request, reply) => {
    const name = readName(request.body);
    if (name === null) return reply.code(400).send({ error: 'name must be a string' });

    return createOutcome(reply, await options.projects.createProject(name));
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
