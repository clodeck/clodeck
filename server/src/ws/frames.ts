/**
 * The raw-socket wire details shared by the `/ws` bus and the raw-byte
 * `/ws/terminal` transport.
 *
 * Both routes do the same two things before their real work: read a frame's
 * bytes back out of whatever `ws` handed them over as, and check a socket is
 * still `OPEN` before writing to it. Those facts were stated twice — once in
 * each route — and a wire detail that drifts between two sockets is a bug no
 * test would name. They live here once instead.
 *
 * Values and pure helpers only: no route, no socket, no framework.
 */

/** `ws` calls this OPEN; a plain number so a caller imports no runtime `ws`. */
export const WS_OPEN = 1;

/** The text of a frame, however `ws` delivered it — string, Buffer, or fragments. */
export function textOf(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return '';
}
