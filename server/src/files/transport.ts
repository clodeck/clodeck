import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import path from 'node:path';

import type { ProjectDiscovery } from '../discovery.js';
import { createScopedFs } from './scoped-fs.js';

/**
 * The file-drawer REST surface (spec-04 §"REST routes"): directory listing and
 * file content as read-only GETs, registered into the app's own `/api` scope so
 * they sit behind the same (future) auth hook as sessions and terminal-size.
 *
 * Every `:id` re-enters `resolveProject` (the only place an id becomes a
 * directory), and every `?path=` is syntax-checked *before* it reaches the
 * reader — but the real boundary is `ScopedFs.resolve`, which re-validates the
 * joined path through realpath containment regardless.
 */
export function registerFileRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery },
): void {
  api.get<{ Params: { id: string } }>('/projects/:id/files', async (request, reply) => {
    const project = await options.projects.resolveProject(request.params.id);
    if (project === null) return notFound(reply);

    const rel = readRelPath(request);
    if (rel === null) return badPath(reply);

    const files = createScopedFs(project.path);
    const resolved = await files.resolve(rel);
    if (resolved.status !== 'ok') return missing(reply);
    if (resolved.kind !== 'directory') return reply.code(400).send({ error: 'path is not a directory' });

    return { entries: await files.listDir(resolved.scoped) };
  });

  api.get<{ Params: { id: string } }>('/projects/:id/files/content', async (request, reply) => {
    const project = await options.projects.resolveProject(request.params.id);
    if (project === null) return notFound(reply);

    const rel = readRelPath(request);
    if (rel === null) return badPath(reply);

    const files = createScopedFs(project.path);
    const resolved = await files.resolve(rel);
    if (resolved.status !== 'ok') return missing(reply);
    if (resolved.kind !== 'file') return reply.code(400).send({ error: 'path is not a file' });

    return { content: await files.readFile(resolved.scoped) };
  });
}

/**
 * The client-supplied relative path, or `null` when it is not a plain relative
 * path. Omitted and empty both mean the project root (`''`). Separators are `/`;
 * a `\`, a `..`/`.`/empty segment, an absolute path, a drive letter, or a NUL is
 * a rejection — a 400 *before* the reader is consulted. This check is not the
 * security boundary (that is realpath containment in `ScopedFs.resolve`); it is
 * a cheap early refusal.
 */
function readRelPath(request: FastifyRequest): string | null {
  const query: unknown = request.query;
  if (query === null || typeof query !== 'object') return '';
  const value = (query as Record<string, unknown>)['path'];
  if (value === undefined) return '';
  if (typeof value !== 'string') return null;

  if (value === '') return '';
  if (value.includes('\0')) return null;
  if (path.isAbsolute(value)) return null;
  if (/^[A-Za-z]:/.test(value)) return null;
  if (!value.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..')) {
    return null;
  }
  return value;
}

/** 404 for a project that is not allowlisted — the same envelope as `sessions.ts`. */
function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'no allowlisted project matches this id' });
}

/** 404 for a path that does not resolve inside the root — never distinguish missing from escape. */
function missing(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'not found' });
}

function badPath(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ error: 'invalid path' });
}
