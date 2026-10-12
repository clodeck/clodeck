import { vi } from 'vitest';

/**
 * Test-only support for mounting the real xterm under jsdom.
 *
 * jsdom implements a DOM but not a browser: there is no WebSocket, no
 * ResizeObserver, no matchMedia and no canvas 2d context, and xterm needs all
 * four just to open. These stubs are the whole gap — with them the *real*
 * `@xterm/xterm` runs and writes a real `.xterm` element into the document, so a
 * test can assert on the DOM rather than on the seam's own bookkeeping.
 *
 * Not a test file: vitest collects `*.test.*` only, and this is the shared half
 * of the terminal tests.
 */

/** Stands in for the terminal and chat sockets: open, silent, never delivers. */
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

/** xterm observes its container to refit; jsdom has no ResizeObserver. */
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

/** A 2d context that accepts every call xterm makes and reads zero-sized. */
const canvasContext = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'measureText') return () => ({ width: 1 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => {} });
      }
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'canvas') return { width: 1, height: 1 };
      if (typeof prop === 'string' && /[A-Za-z]/.test(prop)) {
        return () => {};
      }
      return undefined;
    },
    set() {
      return true;
    },
  },
);

/**
 * Install the four stubs. Call in `beforeEach`; pair with `vi.unstubAllGlobals()`
 * in `afterEach`.
 */
export function stubBrowserForXterm(): void {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  // `getContext` is an overload set (2d / webgl / bitmaprenderer), so the stub is
  // cast to the whole method rather than to its 2d return type.
  HTMLCanvasElement.prototype.getContext = (() =>
    canvasContext) as unknown as HTMLCanvasElement['getContext'];
}
