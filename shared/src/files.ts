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
 * One row of a directory listing. A symlink is its own arm because it is not
 * navigable: the server only reports a link it could not resolve inside the
 * project root — an in-root link is listed under its resolved kind instead.
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
