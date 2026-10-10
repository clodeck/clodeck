/**
 * The terminal transport's pure edges: the two URLs the browser talks to, the
 * POST that carries a resize, and the debounce that paces it. They live apart
 * from `useTerminal` so the parts with no DOM — URL building, the payload, the
 * pacing — stay testable under the node test environment, where the seam's real
 * xterm instance and real socket cannot run.
 *
 * The socket URL is resolved against the page exactly as `useChat`'s is: the Vite
 * dev proxy already carries `/ws` with `ws: true`, so `/ws/terminal` rides the
 * same prefix and production needs no host baked in (spec-03 §"Web client").
 */

/** A trailing-edge debounce: the last call wins, `delayMs` after the quiet. */
export interface Debounced<Args extends unknown[]> {
  call: (...args: Args) => void;
  cancel: () => void;
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    call(...args: Args): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delayMs);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * The raw shell socket. `baseHref` defaults to the page's URL and is only ever
 * passed explicitly by a test — the URL must be resolved against wherever the app
 * is served, never a baked-in host.
 */
export function terminalSocketUrl(projectId: string, baseHref: string = window.location.href): string {
  const url = new URL('/ws/terminal', baseHref);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('projectId', projectId);
  return url.toString();
}

/** `POST /api/projects/:id/terminal/size` (server/src/terminal/transport.ts). */
export function resizeUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/terminal/size`;
}

/**
 * The shell's size in cells — the pair the client posts to the resize endpoint.
 * Named here, on this side of the wire, so `useTerminal` passes one value rather
 * than two loose numbers (xterm's own `onResize` payload already has this shape).
 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * Tell the server the shell's size. Resolves to the response's `ok`: a `404`
 * means the project has no shell open yet (the socket has not finished
 * connecting), which is a dropped resize, not an error to surface.
 */
export async function postTerminalSize(projectId: string, size: TerminalSize): Promise<boolean> {
  const response = await fetch(resizeUrl(projectId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(size),
  });
  return response.ok;
}
