import type { PtyHandle, PtySpawnOptions, PtySpawner } from '../terminal/pty.js';

/**
 * The scripted fake spawner: the second testing seam (spec-03 §Testing).
 *
 * It stands in for node-pty so the terminal manager — and, in ticket 13, the
 * whole `/ws/terminal` transport — is driven with no shell and no real process.
 * Every spawn is recorded, and the handle it hands back is a *control surface*:
 * a test can script the shell's output (`emitData`), make it die (`exit`), and
 * read back everything the server did to it. Test support, not package code:
 * `tsconfig.build.json` keeps `src/testing` out of `dist`.
 */
export interface FakePtySpawner extends PtySpawner {
  /** Every `spawn()` argument, in call order. */
  readonly spawns: readonly PtySpawnOptions[];
  /** Every handle handed out, in call order. */
  readonly handles: readonly FakePtyHandle[];
  /** The n-th handle (1-based). Throws if that many ptys were never spawned. */
  handle(count: number): FakePtyHandle;
  /** The n-th `spawn()` argument (1-based), parking until the server makes it. */
  waitForSpawn(count: number): Promise<PtySpawnOptions>;
}

/** The fake's control surface, on top of the handle the server sees. */
export interface FakePtyHandle extends PtyHandle {
  /** Bytes the server has written to the shell, in call order. */
  readonly written: readonly string[];
  /** Every `resize()` argument, in call order. */
  readonly resizes: readonly { cols: number; rows: number }[];
  readonly pauseCount: number;
  readonly resumeCount: number;
  readonly killCount: number;
  /** Script the shell's own output — the `onData` the server registered fires. */
  emitData(data: string): void;
  /**
   * Script the shell exiting on its own. This is distinct from `kill()`: the
   * manager reaps on *this*, and the real node-pty fires it when the process
   * ends for any reason other than the server having killed it.
   */
  exit(exitCode?: number): void;
}

export function createFakePtySpawner(): FakePtySpawner {
  const spawns: PtySpawnOptions[] = [];
  const handles: FakePtyHandle[] = [];
  const waiters: { count: number; resolve: (options: PtySpawnOptions) => void }[] = [];

  return {
    spawn(options) {
      spawns.push(options);
      handles.push(createFakePty());

      for (let index = 0; index < waiters.length; ) {
        const waiter = waiters[index];
        if (waiter !== undefined && spawns.length >= waiter.count) {
          waiters.splice(index, 1);
          waiter.resolve(spawns[waiter.count - 1] as PtySpawnOptions);
        } else {
          index += 1;
        }
      }

      return handles[handles.length - 1] as FakePtyHandle;
    },

    get spawns() {
      return spawns;
    },

    get handles() {
      return handles;
    },

    handle(count) {
      const handle = handles[count - 1];
      if (handle === undefined) {
        throw new Error(`no pty has been spawned ${count} times`);
      }
      return handle;
    },

    waitForSpawn(count) {
      // Resolves immediately when the spawn already happened, so a test never
      // has to know whether the server got there first.
      if (count <= spawns.length) {
        return Promise.resolve(spawns[count - 1] as PtySpawnOptions);
      }
      return new Promise((resolve) => waiters.push({ count, resolve }));
    },
  };
}

function createFakePty(): FakePtyHandle {
  const written: string[] = [];
  const resizes: { cols: number; rows: number }[] = [];
  let onData: ((data: string) => void) | undefined;
  let onExit: ((exit: { exitCode: number }) => void) | undefined;
  let pauseCount = 0;
  let resumeCount = 0;
  let killCount = 0;

  return {
    onData(cb) {
      onData = cb;
    },
    onExit(cb) {
      onExit = cb;
    },
    write(data) {
      written.push(data);
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    kill() {
      killCount += 1;
    },
    pause() {
      pauseCount += 1;
    },
    resume() {
      resumeCount += 1;
    },

    get written() {
      return written;
    },
    get resizes() {
      return resizes;
    },
    get pauseCount() {
      return pauseCount;
    },
    get resumeCount() {
      return resumeCount;
    },
    get killCount() {
      return killCount;
    },

    emitData(data) {
      onData?.(data);
    },
    exit(exitCode = 0) {
      onExit?.({ exitCode });
    },
  };
}
