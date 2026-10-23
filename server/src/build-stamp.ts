import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBuildStamp, UNKNOWN_BUILD_STAMP, type BuildStamp } from '@clodeck/shared';

/**
 * The stamp `npm run build` baked beside this file (ADR 0004).
 *
 * It is read **once**, at boot, and handed to `buildApp` through `AppOptions`
 * like `webRoot`: the HTTP layer never reaches for git or for a file, so what
 * `/healthz` answers is the artifact's own record rather than a fact looked up
 * at request time. A rebuild writes a new file; a restart is what reads it.
 */

/** The dev loop (`tsx src/main.ts`): no build ran, and the line says so. */
export const DEV_BUILD_STAMP: BuildStamp = { commit: 'dev', builtAt: null, dirty: false };

const STAMP_FILE = 'build-stamp.json';

/**
 * Read the stamp beside `beside` — by default this module's own compiled file,
 * so `dist/build-stamp.js` looks for `dist/build-stamp.json`. In the dev loop
 * the file is absent and {@link DEV_BUILD_STAMP} answers; a present-but-broken
 * file answers {@link UNKNOWN_BUILD_STAMP} rather than failing the boot.
 */
export function readBuildStamp(beside: string = import.meta.url): BuildStamp {
  const file = path.join(path.dirname(fileURLToPath(beside)), STAMP_FILE);

  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    // ENOENT is the dev loop, and the one absence that has a name of its own.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? DEV_BUILD_STAMP
      : UNKNOWN_BUILD_STAMP;
  }

  try {
    const parsed: unknown = JSON.parse(contents);
    return isBuildStamp(parsed) ? parsed : UNKNOWN_BUILD_STAMP;
  } catch {
    return UNKNOWN_BUILD_STAMP;
  }
}
