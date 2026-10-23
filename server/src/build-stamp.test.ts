import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { UNKNOWN_BUILD_STAMP } from '@clodeck/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { DEV_BUILD_STAMP, readBuildStamp } from './build-stamp.js';

/**
 * The one boot-time read of the build stamp (ADR 0004). The file's *content* is
 * the build script's own suite (`scripts/build-stamp.test.mts`); what is pinned
 * here is what the server does with it — the dev loop's absence, a stamp that
 * parses, and a file that does not.
 */

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory where the server's compiled entry point would sit, and its stamp. */
async function artifact(stamp?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'clodeck-stamp-'));
  fixtures.push(dir);
  if (stamp !== undefined) await writeFile(path.join(dir, 'build-stamp.json'), stamp);
  return pathToFileURL(path.join(dir, 'main.js')).href;
}

describe('reading the build stamp at boot', () => {
  it('is the dev loop when there is no file', async () => {
    expect(readBuildStamp(await artifact())).toEqual(DEV_BUILD_STAMP);
    expect(DEV_BUILD_STAMP).toEqual({ commit: 'dev', builtAt: null, dirty: false });
  });

  it('is the artifact’s own record when the file parses', async () => {
    const stamp = {
      commit: 'fcbd770000000000000000000000000000000000',
      builtAt: '2026-10-23T14:05:00.000Z',
      dirty: true,
    };

    expect(readBuildStamp(await artifact(JSON.stringify(stamp)))).toEqual(stamp);
  });

  it('is unknown, not dev, when the file is there but is not a stamp', async () => {
    for (const contents of ['not json', '{}', '{"commit":"","builtAt":null,"dirty":false}']) {
      expect(readBuildStamp(await artifact(contents))).toEqual(UNKNOWN_BUILD_STAMP);
    }
  });
});
