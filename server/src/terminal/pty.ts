/**
 * The pty facade (spec-03 §"The pty facade"): everything the rest of the server
 * wants from a pseudoterminal, said as a small interface.
 *
 * `node-pty` is a native binding — the same reason the Agent SDK sits behind
 * `SdkProvider` — so it is never imported directly. Exactly one module
 * (`./node-pty-spawner.ts`) imports it for real, and `../testing/fake-pty.ts`
 * stands in for it everywhere else, so no automated test forks a shell.
 *
 * The handle is deliberately narrower than node-pty's own `IPty`: only the
 * surface this slice drives. `pause`/`resume` are here for the flow control the
 * transport wires between xterm.js backpressure and the shell.
 */
export interface PtySpawnOptions {
  /** A canonical project path from `resolveProject()` — never a raw id. */
  cwd: string;
  cols: number;
  rows: number;
}

export interface PtySpawner {
  spawn(options: PtySpawnOptions): PtyHandle;
}

export interface PtyHandle {
  /** The shell's output. Registered once, at spawn. */
  onData(cb: (data: string) => void): void;
  /** The shell exited on its own (not because of `kill()`). */
  onExit(cb: (exit: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pause(): void;
  resume(): void;
}
