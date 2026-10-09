import type { SessionMessage, SessionSummary } from '@clodeck/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ProjectDiscovery } from './discovery.js';
import type { SdkProvider } from './sdk/provider.js';

/**
 * Session history over REST (spec-02 §"Session history & resume (REST)"): the
 * read-only view of the Agent SDK's on-disk transcripts that a client rebuilds
 * its session list and a past conversation from.
 *
 * It is registered into the app's own `/api` scope, so the routes sit behind the
 * same later auth hook as `/api/projects` without a second server — and every
 * `:id` re-enters through `resolveProject`, which is the only place an id
 * becomes a directory (wayfinder 05 §5).
 */
export function registerSessionRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery; provider: SdkProvider },
): void {
  api.get<{ Params: { id: string } }>('/projects/:id/sessions', async (request, reply) => {
    const project = await options.projects.resolveProject(request.params.id);
    if (project === null) return notFound(reply);

    const sessions = await options.provider.listSessions(project.path);
    // The order is this endpoint's own behavior, not the provider's private
    // business: sorting here keeps it true whatever a given provider returns.
    return { sessions: [...sessions].sort(byLastModifiedDesc) };
  });

  api.get<{ Params: { id: string; sid: string } }>(
    '/projects/:id/sessions/:sid/messages',
    async (request, reply) => {
      const project = await options.projects.resolveProject(request.params.id);
      if (project === null) return notFound(reply);

      // No pagination and no reshaping: the provider already drops the SDK's
      // system rows and hands back complete blocks, and a session it does not
      // know is simply an empty transcript — a normal read, not an error.
      const messages: SessionMessage[] = await options.provider.getSessionMessages(
        request.params.sid,
        project.path,
      );
      return { messages };
    },
  );
}

/** The server's REST error shape — one envelope, no second kind (brief §ticket 09). */
function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'no allowlisted project matches this id' });
}

/**
 * `lastModified` descending, with a missing timestamp after every session that
 * has one. `Array.prototype.sort` is stable, so sessions with equal keys — and
 * two sessions that both lack a timestamp — keep the provider's order.
 */
function byLastModifiedDesc(left: SessionSummary, right: SessionSummary): number {
  if (left.lastModified === undefined) return right.lastModified === undefined ? 0 : 1;
  if (right.lastModified === undefined) return -1;
  if (left.lastModified === right.lastModified) return 0;
  // ISO 8601 compares lexicographically in chronological order.
  return left.lastModified < right.lastModified ? 1 : -1;
}
