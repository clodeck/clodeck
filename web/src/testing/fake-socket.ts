/**
 * The socket the chat tests drive: one fake `WebSocket` with `send` recorded as
 * parsed frames, so a test reads the wire the way the server would.
 *
 * It is the shared half of more than one chat suite — the provider the picker
 * sends and the session a chat is in are both read off the same socket — which
 * is why it lives here rather than in one of them (the same reason
 * `direction.ts` exists). Not a test file: vitest collects `*.test.*` only.
 *
 * A test stubs it in place of the browser's own (`vi.stubGlobal('WebSocket',
 * FakeSocket)`) and opens it, which is what makes a panel usable with no server
 * on the other end.
 */
export class FakeSocket {
  static readonly OPEN = 1;
  static readonly instances: FakeSocket[] = [];
  readonly sent: unknown[] = [];
  readonly readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(frame: string): void {
    this.sent.push(JSON.parse(frame) as unknown);
  }

  close(): void {
    // Nothing to tear down: there is no server on the other end of this.
  }

  /** The upgrade succeeded. */
  open(): void {
    this.onopen?.();
  }

  /** Whatever the server would say next. */
  deliver(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** The last frame sent, as the server would parse it. */
  lastSent(): unknown {
    return this.sent.at(-1);
  }
}

/** The socket the panel most recently opened. */
export function latestSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error('the panel opened no socket');
  return socket;
}

/** Forget every socket opened so far — a test that mounts twice counts from zero. */
export function forgetSockets(): void {
  FakeSocket.instances.length = 0;
}
