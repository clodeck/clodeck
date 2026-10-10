import type { PtyHandle, PtySpawnOptions, PtySpawner } from './pty.js';

/**
 * The terminal manager: one shell per project, and the whole lifecycle the
 * `/ws/terminal` transport drives next ticket — open, write, resize, close,
 * dispose — plus the exit that reaps an entry. Like `TurnManager`, it turns one
 * injected seam (the pty facade) into the per-project state the routes need, and
 * it is unit-tested through the fake with no real process.
 *
 * Keyed by projectId rather than by pid: pids get reused, and the transport
 * addresses a shell — to resize it, close it, or ask whether it is live — by the
 * project it belongs to.
 */
export interface OpenTerminalOptions extends PtySpawnOptions {
  /** The shell's output. Bound to this open, so a fresh shell gets a fresh sink. */
  onData: (data: string) => void;
}

export interface TerminalManager {
  /**
   * Spawn a shell for the project. Opening over a live project *replaces* it —
   * a fresh connection gets a fresh shell, never a reused, possibly half-dead
   * one — killing the handle it displaces.
   */
  open(projectId: string, options: OpenTerminalOptions): void;
  /** Send raw input to the project's shell. False when the project has none. */
  write(projectId: string, data: string): boolean;
  /** Resize the project's shell. False when the project has none. */
  resize(projectId: string, cols: number, rows: number): boolean;
  /** Stop reading the project's shell (flow control). False when it has none. */
  pause(projectId: string): boolean;
  /** Resume reading the project's shell (flow control). False when it has none. */
  resume(projectId: string): boolean;
  /** Kill the project's shell and forget it. False when it had none. */
  close(projectId: string): boolean;
  /** Whether the project currently has a live shell. */
  has(projectId: string): boolean;
  /**
   * Be told when a project's shell exits on its own — the transport closes that
   * project's socket. Returns an unsubscribe.
   */
  onExit(listener: (projectId: string) => void): () => void;
  /** Kill every shell. A shutdown, not a per-project close. */
  dispose(): void;
}

export function createTerminalManager(spawner: PtySpawner): TerminalManager {
  const terminals = new Map<string, PtyHandle>();
  const exitListeners = new Set<(projectId: string) => void>();

  /**
   * Kill the entry for a project and forget it. Forgotten *before* the kill, so
   * a handle that fires its own exit synchronously during the kill cannot reap
   * the replacement `open` is about to install.
   */
  function killAndForget(projectId: string): boolean {
    const handle = terminals.get(projectId);
    if (handle === undefined) return false;

    terminals.delete(projectId);
    handle.kill();
    return true;
  }

  /** A handle's exit reaps its entry, but only if it is still the live one. */
  function reap(projectId: string, handle: PtyHandle): void {
    // A replaced handle still fires its exit; the entry now names its successor.
    if (terminals.get(projectId) !== handle) return;

    terminals.delete(projectId);
    for (const listener of exitListeners) listener(projectId);
  }

  return {
    open(projectId, options) {
      killAndForget(projectId);

      const handle = spawner.spawn({ cwd: options.cwd, cols: options.cols, rows: options.rows });
      terminals.set(projectId, handle);
      handle.onData(options.onData);
      handle.onExit(() => reap(projectId, handle));
    },

    write(projectId, data) {
      const handle = terminals.get(projectId);
      if (handle === undefined) return false;
      handle.write(data);
      return true;
    },

    resize(projectId, cols, rows) {
      const handle = terminals.get(projectId);
      if (handle === undefined) return false;
      handle.resize(cols, rows);
      return true;
    },

    pause(projectId) {
      const handle = terminals.get(projectId);
      if (handle === undefined) return false;
      handle.pause();
      return true;
    },

    resume(projectId) {
      const handle = terminals.get(projectId);
      if (handle === undefined) return false;
      handle.resume();
      return true;
    },

    close(projectId) {
      return killAndForget(projectId);
    },

    has(projectId) {
      return terminals.has(projectId);
    },

    onExit(listener) {
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },

    dispose() {
      // Cleared before the kills, so a handle's exit during shutdown cannot
      // notify listeners that the process is going away anyway.
      const handles = [...terminals.values()];
      terminals.clear();
      for (const handle of handles) handle.kill();
    },
  };
}
