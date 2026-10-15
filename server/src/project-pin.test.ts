import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createScopedFs } from './files/scoped-fs.js';
import { isPinned, NO_PIN, readPin, readProjectPin, type ProjectPin } from './project-pin.js';
import { createSandbox, linkType, removeSandbox, type Sandbox } from './test-support.js';

/**
 * A project's pin, from a JSON object and from a directory on disk: which of the
 * three keys a file declares, and nothing else. No server, no key, no network —
 * the same shape `config.test.ts` and `allowlist.test.ts` test their own pure
 * readers in.
 *
 * The file half goes through a real `ScopedFs` over a real temp directory,
 * because that is the seam the ticket names: the reading is only "the same
 * containment every other read uses" if a path that escapes the project is
 * answered the same way here.
 */

/** Collects the lines the reader reports, so a warning is assertable. */
function collectingWarnings(): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

describe('the keys a settings file declares', () => {
  it('reads the three keys, and only the ones the file actually names', () => {
    expect(
      readPin({
        env: {
          ANTHROPIC_BASE_URL: 'https://vendor.example/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'a-credential',
          ANTHROPIC_MODEL: 'vendor-model-1',
          // Not one of the three: a settings file is about more than the provider.
          SOME_OTHER_SETTING: 'x',
        },
      }),
    ).toEqual({
      baseUrl: 'https://vendor.example/anthropic',
      authToken: 'a-credential',
      model: 'vendor-model-1',
    });

    // A file that names one key declares one key: an absent field is a key the
    // file says nothing about, not a blank to be filled in.
    expect(readPin({ env: { ANTHROPIC_MODEL: 'vendor-model-1' } })).toEqual({ model: 'vendor-model-1' });
  });

  it('reads past an env value that could not have come from an environment', () => {
    // A number or a nested object inside `env` is not something a shell could
    // have exported, so that key declares nothing — while a string beside it
    // still declares, rather than the whole block being thrown away.
    expect(readPin({ env: { ANTHROPIC_BASE_URL: 42, ANTHROPIC_MODEL: 'vendor-model-1' } })).toEqual({
      model: 'vendor-model-1',
    });
  });

  it('treats a blank value as no declaration, by the one definition of unset the server has', () => {
    expect(readPin({ env: { ANTHROPIC_BASE_URL: '  ', ANTHROPIC_MODEL: '' } })).toEqual(NO_PIN);
  });

  it('reads a file that declares nothing about the provider as no pin, quietly', () => {
    const { warnings, warn } = collectingWarnings();

    // A valid settings file is usually about something else — permissions, hooks
    // — and says nothing about the provider. There is nothing to report.
    expect(readPin({ permissions: { allow: ['Read'] } }, warn)).toEqual(NO_PIN);
    expect(readPin({ env: {} }, warn)).toEqual(NO_PIN);
    expect(warnings).toEqual([]);
  });

  it('reports a document it cannot use rather than throwing on it', () => {
    const { warnings, warn } = collectingWarnings();

    // A number, a string and a list are all valid JSON and none of them is a
    // settings object; a string `env` is the same mistake one level in.
    expect(readPin(42, warn)).toEqual(NO_PIN);
    expect(readPin('nope', warn)).toEqual(NO_PIN);
    expect(readPin([], warn)).toEqual(NO_PIN);
    expect(readPin({ env: 'nope' }, warn)).toEqual(NO_PIN);
    expect(readPin({ env: ['ANTHROPIC_BASE_URL'] }, warn)).toEqual(NO_PIN);

    expect(warnings).toHaveLength(5);
    expect(warnings.every((line) => line.includes('pins no provider'))).toBe(true);
  });

  it('is pinned when the file names the endpoint or the credential, and only then', () => {
    expect(isPinned({ baseUrl: 'https://vendor.example/anthropic' })).toBe(true);
    expect(isPinned({ authToken: 'a-credential' })).toBe(true);
    expect(isPinned({ baseUrl: 'https://v.example', authToken: 'c' })).toBe(true);
    // A model is not a pin: the model travels free (ADR 0002).
    expect(isPinned({ model: 'vendor-model-1' })).toBe(false);
    expect(isPinned(NO_PIN)).toBe(false);
  });
});

describe('the pin a project reads off its own disk', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-pin-');
    root = sandbox.root;
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  /** A project directory whose `.claude/settings.json` holds exactly `settings`. */
  async function project(name: string, settings?: string): Promise<string> {
    const dir = path.join(root, name);
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    if (settings !== undefined) {
      await writeFile(path.join(dir, '.claude', 'settings.json'), settings);
    }
    return realpath(dir);
  }

  /** The pin that directory declares, and whatever the reading had to report. */
  async function pinOf(directory: string): Promise<{ pin: ProjectPin; warnings: string[] }> {
    const { warnings, warn } = collectingWarnings();
    const pin = await readProjectPin(createScopedFs(directory), warn);
    return { pin, warnings };
  }

  it('reads a deployed project: the env block of its own settings file', async () => {
    const directory = await project(
      'pinned',
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://vendor.example/anthropic' } }),
    );

    const { pin, warnings } = await pinOf(directory);

    expect(pin).toEqual({ baseUrl: 'https://vendor.example/anthropic' });
    expect(warnings).toEqual([]);
  });

  it('reads a project with no settings file as pinning nothing, and says nothing about it', async () => {
    // The common case, and the one ticket 68 shipped: a project that pins nothing
    // mostly has no such file, and a line per turn for each of them would bury
    // the lines that matter.
    const directory = await project('plain');

    expect(await pinOf(directory)).toEqual({ pin: NO_PIN, warnings: [] });
  });

  it('reads a JSON file it cannot parse as pinning nothing, with a line saying so', async () => {
    const directory = await project('broken', '{ this is not json');

    const { pin, warnings } = await pinOf(directory);

    expect(pin).toEqual(NO_PIN);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.claude/settings.json');
  });

  it('reads a `.claude` that points outside the project as pinning nothing', async () => {
    // The reason this reading goes through `ScopedFs`: a project's file is only
    // its own if it is inside the project. One that escapes is not read at all.
    const outside = path.join(sandbox.dir, 'outside');
    await mkdir(outside);
    await writeFile(
      path.join(outside, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://elsewhere.example' } }),
    );

    const directory = path.join(root, 'escaping');
    await mkdir(directory);
    await symlink(outside, path.join(directory, '.claude'), linkType);

    const { pin, warnings } = await pinOf(await realpath(directory));

    expect(pin).toEqual(NO_PIN);
    expect(warnings).toHaveLength(1);
  });
});
