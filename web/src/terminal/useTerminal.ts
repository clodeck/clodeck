import type { Project } from '@clodeck/shared';
import { AttachAddon } from '@xterm/addon-attach';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useState } from 'react';

import { debounce, postTerminalSize, terminalSocketUrl, type TerminalSize } from './transport';

/**
 * The terminal data seam, shaped like `useChat` / `useProjects`: a discriminated
 * state union and one effect that owns *both* long-lived objects — the xterm
 * instance and the raw `/ws/terminal` socket — and tears both down on unmount.
 * Everything imperative about xterm lives here, so `TerminalPanel` only mounts a
 * container and reads the connection state.
 *
 * There is no reconnect, unlike `useChat`: the shell does not live on the server
 * across a gap — a reload is a fresh shell, and a replaced socket's shell is
 * killed (spec-03 §"The `/ws/terminal` route") — so a closed socket ends this
 * terminal rather than pausing it.
 */

export type TerminalConnection = 'connecting' | 'live' | 'error';

export interface TerminalController {
  connection: TerminalConnection;
  /** Attach to the panel's container element; xterm mounts into it. */
  containerRef: (element: HTMLDivElement | null) => void;
}

/** How long a resize must be quiet before the pty hears about it. */
const RESIZE_DEBOUNCE_MS = 150;

export function useTerminal(project: Project): TerminalController {
  const [connection, setConnection] = useState<TerminalConnection>('connecting');
  // The node itself, in state, so the effect can run once it exists and clean up
  // when it goes away — the ref callback React calls on mount and unmount.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (container === null) return;

    setConnection('connecting');

    const socket = new WebSocket(terminalSocketUrl(project.id));
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      // The palette of index.css, so the terminal sits in the shell, not beside it.
      theme: { background: '#0b0d10', foreground: '#e7edf3', cursor: '#c96442' },
    });

    // The attach addon *is* the raw-byte channel: it writes incoming frames and
    // sends input, but it never sends a size (research 02 §2) — resize is wired
    // by hand below. Terminal bytes reach the screen only through xterm's own
    // renderer: no innerHTML, no linkifier, no parser hook (research 02 §3).
    const attach = new AttachAddon(socket);
    terminal.loadAddon(attach);

    const fit = new FitAddon();
    terminal.loadAddon(fit);

    terminal.open(container);
    // Fit before anything is sent: the pty and the grid must agree from the start.
    fit.fit();

    const sendSize = (size: TerminalSize): void => {
      // Only while a shell exists: before the socket opens the server has no
      // terminal to resize (the POST would 404), and after it closes there is
      // nothing left to resize.
      if (socket.readyState !== WebSocket.OPEN) return;
      void postTerminalSize(project.id, size).catch(() => {
        // A resize that does not land is not worth surfacing; the next one
        // carries the same size.
      });
    };

    // A resize storm (dragging the splitter) must not become a POST storm.
    const scheduledResize = debounce(sendSize, RESIZE_DEBOUNCE_MS);
    const resizeSub = terminal.onResize((size) => {
      scheduledResize.call(size);
    });

    // Keep the grid the size of the panel. A `fit()` that changes the grid is
    // what fires `onResize`, which is what actually reaches the pty.
    const observer = new ResizeObserver(() => {
      fit.fit();
    });
    observer.observe(container);

    socket.onopen = () => {
      setConnection('live');
      // The server spawns at a fixed 80×24 and the addon never sends a size, so
      // without this the pty would stay 80×24 until the user happened to resize.
      // Push the real size once, now that the shell exists.
      sendSize({ cols: terminal.cols, rows: terminal.rows });
    };

    // Close and error are the same end for a terminal: the shell is gone. The
    // panel says so rather than reconnecting into a shell that never survived.
    socket.onclose = () => {
      setConnection('error');
    };
    socket.onerror = () => {
      setConnection('error');
    };

    return () => {
      // Detach first, so closing the socket cannot fire a handler into a tree
      // that is being torn down.
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      resizeSub.dispose();
      scheduledResize.cancel();
      observer.disconnect();
      attach.dispose();
      fit.dispose();
      terminal.dispose();
      socket.close();
    };
  }, [project.id, container]);

  const containerRef = useCallback((element: HTMLDivElement | null) => {
    setContainer(element);
  }, []);

  return { connection, containerRef };
}
