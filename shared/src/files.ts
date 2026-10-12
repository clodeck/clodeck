/**
 * File-drawer contracts (spec-04): the wire shapes the file viewer serves over
 * REST and renders. These are REST shapes, not `/ws` envelope kinds, so
 * `protocol.ts` is untouched by this slice — they sit beside `session.ts` the
 * same way the terminal's raw bytes sit beside the JSON bus.
 *
 * Both are discriminated unions on purpose: the client renders them with an
 * exhaustive `switch`, so a new entry type or content kind is a compile error
 * at the renderer rather than a silently missed branch.
 */

/**
 * The upload ceiling, in bytes: a raw-body PUT may be at most 200 MiB, larger is
 * a `413`. It lives here rather than beside the route because the client refuses
 * an oversize file before it makes the request at all, so the number has exactly
 * one home — the route's `bodyLimit`, the overlay's "max N MB" and the message a
 * rejected file carries are all the same constant, and cannot drift apart.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** The same ceiling in the unit the drawer says it in: derived, never a second literal. */
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/**
 * One row of a directory listing. A symlink is its own arm because it is not
 * navigable: the server only reports a link it could not resolve inside the
 * project root — an in-root link is listed under its resolved kind instead.
 *
 * Only a file carries `size`/`mtime`, and that is the whole of what a row may
 * show about it: the server reports no permissions, so there is no permission
 * column to render (spec-04's metadata scope, narrowed by ticket 32).
 */
export type FileEntry =
  | { type: 'file'; name: string; size: number; mtime: string }
  | { type: 'directory'; name: string }
  | { type: 'symlink'; name: string };

/**
 * One file's content. Text is capped and truncated by the server, so `content`
 * is never the whole file when it is large; binary is never streamed at all —
 * only its size is reported.
 */
export type FileContent =
  | { kind: 'text'; content: string; truncated: boolean; size: number }
  | { kind: 'binary'; size: number };
