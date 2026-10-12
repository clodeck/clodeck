import { MAX_UPLOAD_BYTES } from '@clodeck/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import path from 'node:path';

import type { ProjectDiscovery } from '../discovery.js';
import { createScopedFs, name, type ScopedFs, type WriteResult, type WriteTargetResult } from './scoped-fs.js';

/**
 * The file-drawer REST surface (spec-04 §"REST routes"): directory listing and
 * file content as read-only GETs, plus the write half — create, rename, delete,
 * a raw upload, and a save (the one deliberate overwrite of an existing file) —
 * registered into the app's own `/api` scope so they sit behind the same
 * (future) auth hook as sessions and terminal-size.
 *
 * One door opens every route. `:id` re-enters `resolveProject` (the only place
 * an id becomes a directory) and `?path=` passes the single syntax check,
 * `relPath`, whether the route reads or writes — so the same bad path is the
 * same 400 on either side. A write's own door (`resolveWriteTarget` + `name`)
 * still re-checks the basename, but it is no longer the only check a write
 * sees. Either way the real boundary is the reader's realpath containment,
 * which re-validates the joined path regardless.
 *
 * The upload cap ({@link MAX_UPLOAD_BYTES}) is imported rather than declared: the
 * drawer refuses an oversize file before it sends anything, so the number the
 * client checks and the number these two `bodyLimit`s enforce are one constant —
 * a `413` here is the backstop for a request that skipped the client.
 */

export function registerFileRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery },
): void {
  // A raw upload is bytes, not JSON: an octet-stream body arrives as a `Buffer`
  // so the route can hand it straight to `createFile`. Fastify ships no parser
  // for this media type, so without this an upload is a 415 before the route.
  api.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  api.get<{ Params: { id: string } }>('/projects/:id/files', async (request, reply) => {
    const opened = await openProject(request, reply, options);
    if (opened === null) return reply;
    const { files, rel } = opened;

    const resolved = await files.resolve(rel);
    if (resolved.status !== 'ok') return missing(reply);
    if (resolved.kind !== 'directory') return reply.code(400).send({ error: 'path is not a directory' });

    return { entries: await files.listDir(resolved.scoped) };
  });

  api.get<{ Params: { id: string } }>('/projects/:id/files/content', async (request, reply) => {
    const opened = await openProject(request, reply, options);
    if (opened === null) return reply;
    const { files, rel } = opened;

    const resolved = await files.resolve(rel);
    if (resolved.status !== 'ok') return missing(reply);
    if (resolved.kind !== 'file') return reply.code(400).send({ error: 'path is not a file' });

    return { content: await files.readFile(resolved.scoped) };
  });

  api.post<{ Params: { id: string }; Body: unknown }>('/projects/:id/files', async (request, reply) => {
    const opened = await openProject(request, reply, options);
    if (opened === null) return reply;
    const { files, rel } = opened;

    const kind = readKind(request.body);
    if (kind === null) return reply.code(400).send({ error: "kind must be 'file' or 'directory'" });

    const target = await files.resolveWriteTarget(rel);
    if (target.status !== 'ok') return targetFailed(reply, target.status);

    const result =
      kind === 'directory'
        ? await files.createDirectory(target.target)
        : await files.createFile(target.target, Buffer.alloc(0));
    return writeOutcome(reply, result, 201);
  });

  api.post<{ Params: { id: string }; Body: unknown }>(
    '/projects/:id/files/rename',
    async (request, reply) => {
      const opened = await openProject(request, reply, options);
      if (opened === null) return reply;
      const { files, rel } = opened;

      const to = readTo(request.body);
      const newName = to === null ? null : name(to);
      if (newName === null) return reply.code(400).send({ error: 'to must be a single file name' });

      const target = await files.resolveWriteTarget(rel);
      if (target.status !== 'ok') return targetFailed(reply, target.status);

      return writeOutcome(reply, await files.rename(target.target, newName), 200);
    },
  );

  api.delete<{ Params: { id: string } }>('/projects/:id/files', async (request, reply) => {
    const opened = await openProject(request, reply, options);
    if (opened === null) return reply;
    const { files, rel } = opened;

    const target = await files.resolveWriteTarget(rel);
    if (target.status !== 'ok') return targetFailed(reply, target.status);

    return writeOutcome(reply, await files.remove(target.target), 200);
  });

  api.put<{ Params: { id: string } }>(
    '/projects/:id/files/content',
    { bodyLimit: MAX_UPLOAD_BYTES },
    async (request, reply) => {
      const opened = await openProject(request, reply, options);
      if (opened === null) return reply;
      const { files, rel } = opened;

      // An upload is create, never overwrite (spec-04 §Writes): the body must be
      // raw bytes, and anything else — a JSON object, an absent body — is a 400
      // before the reader is consulted.
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: 'a raw application/octet-stream body is required' });
      }

      const target = await files.resolveWriteTarget(rel);
      if (target.status !== 'ok') return targetFailed(reply, target.status);

      return writeOutcome(reply, await files.createFile(target.target, request.body), 201);
    },
  );

  api.post<{ Params: { id: string } }>(
    '/projects/:id/files/save',
    { bodyLimit: MAX_UPLOAD_BYTES },
    async (request, reply) => {
      const opened = await openProject(request, reply, options);
      if (opened === null) return reply;
      const { files, rel } = opened;

      // Save is an overwrite of an existing file (the editable toggle's write),
      // unlike the PUT above, which is a create. Same raw-byte contract.
      if (!Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ error: 'a raw application/octet-stream body is required' });
      }

      const target = await files.resolveWriteTarget(rel);
      if (target.status !== 'ok') return targetFailed(reply, target.status);

      return writeOutcome(reply, await files.overwriteFile(target.target, request.body), 200);
    },
  );
}

/**
 * Open a file route: resolve `:id` to a project (the only place an id becomes a
 * directory) and run `?path=` through the shared syntax check — or send the
 * matching 404/400 itself and return `null`. Every route opens with this, so a
 * read and a write reject the same bad `path` with the same `400`.
 */
async function openProject(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  options: { projects: ProjectDiscovery },
): Promise<{ files: ScopedFs; rel: string } | null> {
  const project = await options.projects.resolveProject(request.params.id);
  if (project === null) {
    notFound(reply);
    return null;
  }

  const rel = relPath(request);
  if (rel === null) {
    badPath(reply);
    return null;
  }

  return { files: createScopedFs(project.path), rel };
}

/**
 * The client-supplied relative path, or `null` when it is not a plain relative
 * path. This one check fronts *every* file route, read and write alike: omitted
 * and empty both mean the project root (`''`); separators are `/`; a `\`, a
 * `..`/`.`/empty segment, an absolute path, a drive letter, or a NUL is a
 * rejection — a 400 *before* the reader is consulted. A write still re-checks
 * its basename through `resolveWriteTarget` + `name`, but that is no longer its
 * only check. This is not the security boundary (that is realpath containment
 * in `ScopedFs.resolve`); it is a cheap early refusal.
 */
function relPath(request: FastifyRequest): string | null {
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

/** A create request's `kind`: `file` or `directory`, or `null` for anything else. */
function readKind(body: unknown): 'file' | 'directory' | null {
  if (typeof body !== 'object' || body === null) return null;
  const kind = (body as Record<string, unknown>)['kind'];
  return kind === 'file' || kind === 'directory' ? kind : null;
}

/** A rename request's `to`: a string, or `null` when it is missing or not a string. */
function readTo(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const to = (body as Record<string, unknown>)['to'];
  return typeof to === 'string' ? to : null;
}

/**
 * Map a failed `WriteTargetResult` to a status code: the root, a non-directory
 * parent, and a bad basename are 400s (a syntax/kind refusal); a missing or
 * escaping parent is folded into the same 404 as any other miss, so the
 * response never reveals which.
 */
function targetFailed(
  reply: FastifyReply,
  status: Exclude<WriteTargetResult['status'], 'ok'>,
): FastifyReply {
  switch (status) {
    case 'is_root':
      return reply.code(400).send({ error: 'the project root is not a valid write target' });
    case 'invalid_name':
      return reply.code(400).send({ error: 'invalid name' });
    case 'not_a_directory':
      return reply.code(400).send({ error: 'parent is not a directory' });
    case 'not_found':
    case 'outside_root':
      return missing(reply);
  }
}

/**
 * Map a `WriteResult` to a status code. `ok` sends the caller's success code
 * (201 for a create/upload, 200 for a rename/delete/save); the refusals are
 * `exists` → 409, a final-segment symlink → 400 (never followed), a target that
 * is not a regular file → 400, and a missing entry → the same 404 as everything
 * else.
 */
function writeOutcome(reply: FastifyReply, result: WriteResult, okCode: 200 | 201): FastifyReply {
  switch (result.status) {
    case 'ok':
      return reply.code(okCode).send({ ok: true });
    case 'exists':
      return reply.code(409).send({ error: 'already exists' });
    case 'symlink':
      return reply.code(400).send({ error: 'refusing to write through a symlink' });
    case 'not_a_file':
      return reply.code(400).send({ error: 'target is not a regular file' });
    case 'not_found':
      return missing(reply);
  }
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
