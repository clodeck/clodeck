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
 * surface this slice drives. `pause`/`resume` are the facade's seam for flow
 * control — spec-03's facade names them — but nothing in this slice wires them:
 * the pty is spawned with node-pty's own `handleFlowControl` high-watermark (see
 * `./node-pty-spawner.ts`), and wiring the *client's* xterm backlog would need a
 * framed PAUSE/RESUME channel, which spec-03 puts out of MVP. The methods stay
 * so that seam can be filled behind the same interface.
 */

/**
 * The grid's size in cells. The pair travels together — from the client's
 * `onResize`, through the resize endpoint, down to `PtyHandle.resize` — so it is
 * named once here, at the seam's home, rather than as two loose numbers.
 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface PtySpawnOptions extends TerminalSize {
  /** A canonical project path from `resolveProject()` — never a raw id. */
  cwd: string;
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
