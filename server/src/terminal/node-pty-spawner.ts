import { spawn } from 'node-pty';

import { platformShell, terminalEnv } from './platform-shell.js';
import type { PtyHandle, PtySpawnOptions, PtySpawner } from './pty.js';

/**
 * The real pty spawner: the only module in the repo that imports node-pty (spec-03
 * §"The pty facade"). node-pty is a native binding, so it is kept behind the
 * `PtySpawner` interface exactly as the Agent SDK is kept behind `SdkProvider` —
 * nothing else `tsc` compiles ever sees this import, and every automated test
 * runs against `../testing/fake-pty.ts` instead.
 *
 * The shell and environment choices live in `./platform-shell.ts` (pure, and
 * tested without this binding); this module is only the thin adapter from the
 * facade's handle to node-pty's `IPty`, plus the spawn call the spec leaves to a
 * manual check.
 */
export function createNodePtySpawner(): PtySpawner {
  return {
    spawn(options: PtySpawnOptions): PtyHandle {
      const pty = spawn(platformShell(process.platform, process.env['SHELL']), [], {
        // `name` is what the child sees as $TERM; it matches the value the
        // environment carries, so a TUI reads the same capability either way.
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: terminalEnv(process.env),
        // node-pty's own high-watermark: it pauses the child when its internal
        // buffer backs up, and resumes it as the reader catches up. This is not
        // the client-side flow control the spec leaves out of MVP; see `./pty.ts`
        // on the `pause`/`resume` seam.
        handleFlowControl: true,
      });

      return {
        onData: (cb) => {
          pty.onData(cb);
        },
        // node-pty also reports a signal; the facade only needs the exit code.
        onExit: (cb) => {
          pty.onExit(({ exitCode }) => cb({ exitCode }));
        },
        write: (data) => {
          pty.write(data);
        },
        resize: (cols, rows) => {
          pty.resize(cols, rows);
        },
        kill: () => {
          pty.kill();
        },
        pause: () => {
          pty.pause();
        },
        resume: () => {
          pty.resume();
        },
      };
    },
  };
}
