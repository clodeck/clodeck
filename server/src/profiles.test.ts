import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectDiscovery } from './discovery.js';
import {
  applyPin,
  createProviderProfiles,
  listProfiles,
  resolveProfile,
  summarizeProfiles,
  UnknownProfileError,
  type ProviderProfile,
} from './profiles.js';
import { readPin } from './project-pin.js';
import {
  createSandbox,
  createTestApp,
  login,
  removeSandbox,
  type Sandbox,
} from './test-support.js';

/**
 * The profile rules, against an environment object and nothing else: no server,
 * no key, no network (spec-08 §"The provider module"). What is pinned here is
 * the *external* behaviour — what an environment means, what a name resolves to,
 * and what a project's pin then leaves of it — never a private helper.
 *
 * The route at the end is the same feature's other end, through the app's own
 * seam: what a browser is handed, and what it is not.
 */

/** A server that has declared its own provider, the way every existing deployment had. */
const SERVER_ENV: NodeJS.ProcessEnv = {
  ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
  ANTHROPIC_AUTH_TOKEN: 'server-credential',
  ANTHROPIC_MODEL: 'claude-opus-5-5',
};

/** Collects the lines a run of the reader reports, so a warning is assertable. */
function collectingWarnings(): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

function declared(profiles: readonly ProviderProfile[], name: string): ProviderProfile['declared'] {
  const profile = profiles.find((candidate) => candidate.name === name);
  if (profile === undefined) throw new Error(`no profile named ${name}`);
  return profile.declared;
}

describe('the profile list', () => {
  it('is the reserved default alone, and means the server’s own environment, when nothing is declared', () => {
    const profiles = listProfiles(SERVER_ENV);

    expect(profiles.map((profile) => profile.name)).toEqual(['default']);
    // Nothing declared is not a trio of blanks: every key is the server's own.
    expect(resolveProfile(profiles, SERVER_ENV, 'default').provider).toEqual({
      baseUrl: 'https://gateway.example/anthropic',
      authToken: 'server-credential',
      model: 'claude-opus-5-5',
    });
  });

  it('reads the three declared keys, names a profile one way, and sorts the list alphabetically', () => {
    const profiles = listProfiles({
      ...SERVER_ENV,
      // The spoken spelling and the exported one are the same profile, so a tier
      // can be declared with a dash wherever a dash is legible.
      'CLODECK_PROVIDER_DEEPSEEK-FLASH_MODEL': 'deepseek-chat',
      CLODECK_PROVIDER_DEEPSEEK_FLASH_BASE_URL: 'https://api.deepseek.com/anthropic',
      CLODECK_PROVIDER_DEEPSEEK_FLASH_AUTH_TOKEN: 'deepseek-credential',
      CLODECK_PROVIDER_ZULU_MODEL: 'zulu-1',
    });

    // Case-insensitively alphabetical, which is what puts `default` between the
    // operator's two names rather than after both of them.
    expect(profiles.map((profile) => profile.name)).toEqual([
      'DEEPSEEK_FLASH',
      'default',
      'ZULU',
    ]);
    expect(declared(profiles, 'DEEPSEEK_FLASH')).toEqual({
      baseUrl: 'https://api.deepseek.com/anthropic',
      authToken: 'deepseek-credential',
      model: 'deepseek-chat',
    });
    expect(declared(profiles, 'ZULU')).toEqual({ model: 'zulu-1' });
  });

  it('lets a profile declare any subset, and fills the rest from the server’s environment', () => {
    const profiles = listProfiles({
      ...SERVER_ENV,
      // A tier: a second model on the endpoint and credential the server already
      // has. This is the one-line profile the whole feature exists for.
      CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5',
      // And the other half: a vendor whose model the server does not name.
      CLODECK_PROVIDER_VENDOR_BASE_URL: 'https://vendor.example/anthropic',
    });

    expect(resolveProfile(profiles, SERVER_ENV, 'FAST').provider).toEqual({
      baseUrl: 'https://gateway.example/anthropic',
      authToken: 'server-credential',
      model: 'claude-haiku-5-5',
    });
    expect(resolveProfile(profiles, SERVER_ENV, 'VENDOR').provider).toEqual({
      baseUrl: 'https://vendor.example/anthropic',
      authToken: 'server-credential',
      model: 'claude-opus-5-5',
    });
  });

  it('treats a blank value as no declaration: an empty key inherits, and one alone names no profile', () => {
    const profiles = listProfiles({
      ...SERVER_ENV,
      CLODECK_PROVIDER_FAST_MODEL: '  ',
      CLODECK_PROVIDER_VENDOR_BASE_URL: 'https://vendor.example/anthropic',
      CLODECK_PROVIDER_VENDOR_MODEL: '',
    });

    // `FAST` declared nothing at all, so it is not a name the picker can offer —
    // an empty export is a shell accident, not a profile asking for a blank.
    // A key that is empty beside a real one is only that key going unset.
    expect(profiles.map((profile) => profile.name)).toEqual(['default', 'VENDOR']);
    expect(resolveProfile(profiles, SERVER_ENV, 'VENDOR').provider).toEqual({
      baseUrl: 'https://vendor.example/anthropic',
      authToken: 'server-credential',
      model: 'claude-opus-5-5',
    });
  });

  it('refuses a name that clashes with the reserved one, and reports which key it ignored', () => {
    const { warnings, warn } = collectingWarnings();
    const profiles = listProfiles(
      { ...SERVER_ENV, CLODECK_PROVIDER_DEFAULT_MODEL: 'taken', CLODECK_PROVIDER_Default_MODEL: 'also' },
      warn,
    );

    // The reserve holds: `default` is still the server's own environment.
    expect(profiles.map((profile) => profile.name)).toEqual(['default']);
    expect(resolveProfile(profiles, SERVER_ENV, 'default').provider.model).toBe('claude-opus-5-5');
    expect(warnings).toHaveLength(2);
    expect(warnings.every((line) => line.includes('reserved'))).toBe(true);
  });

  it('reports a key under its prefix that declares nothing', () => {
    const { warnings, warn } = collectingWarnings();
    const profiles = listProfiles({ ...SERVER_ENV, CLODECK_PROVIDER_FAST_TIMEOUT: '30' }, warn);

    expect(profiles.map((profile) => profile.name)).toEqual(['default']);
    expect(warnings[0]).toContain('CLODECK_PROVIDER_FAST_TIMEOUT');
  });
});

describe('resolving a name', () => {
  it('refuses an unknown or stale name visibly instead of falling back to the default', () => {
    const profiles = listProfiles(SERVER_ENV);

    expect(() => resolveProfile(profiles, SERVER_ENV, 'GONE')).toThrow(UnknownProfileError);
    // The name the caller asked for comes back with the refusal, so a stale
    // browser tab can say which profile it no longer has.
    expect(() => resolveProfile(profiles, SERVER_ENV, 'GONE')).toThrow(/GONE/);
  });

  it('builds the complete trio: no key is answered by the default when the profile declares one', () => {
    const profiles = listProfiles({ ...SERVER_ENV, CLODECK_PROVIDER_VENDOR_BASE_URL: 'https://v.example' });
    const { provider } = resolveProfile(profiles, SERVER_ENV, 'VENDOR');

    // The declared endpoint travels with the inherited credential — one source
    // each, never a key from one and a key from the other in the same pair.
    expect(provider.baseUrl).toBe('https://v.example');
    expect(provider.authToken).toBe('server-credential');
  });
});

describe('the profiles a server offers', () => {
  it('reads the environment once, so a running session cannot see a later change', () => {
    const env: NodeJS.ProcessEnv = { ...SERVER_ENV, CLODECK_PROVIDER_FAST_MODEL: 'haiku' };
    const profiles = createProviderProfiles(env, () => undefined);

    env['CLODECK_PROVIDER_FAST_MODEL'] = 'changed';
    env['CLODECK_PROVIDER_NEW_MODEL'] = 'appeared';

    expect(profiles.list().map((entry) => entry.name)).toEqual(['default', 'FAST']);
    expect(profiles.resolve('FAST').provider.model).toBe('haiku');
  });

  it('resolves no name at all to the reserved default, so a client that never chooses is unchanged', () => {
    const profiles = createProviderProfiles(SERVER_ENV, () => undefined);

    expect(profiles.resolve().provider).toEqual(resolveProfile(listProfiles(SERVER_ENV), SERVER_ENV, 'default').provider);
  });

  it('tells the client a name, a model and a shape, and nothing that could be a secret', () => {
    const profiles = createProviderProfiles(
      { ...SERVER_ENV, CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5' },
      () => undefined,
    );

    expect(profiles.list()).toEqual([
      { name: 'default', model: 'claude-opus-5-5', shape: 'tier' },
      { name: 'FAST', model: 'claude-haiku-5-5', shape: 'tier' },
    ]);

    // The whole payload, by key: an endpoint or a credential reaching a client
    // would be a field here, and there is nowhere for one to hide.
    for (const entry of profiles.list()) {
      expect(Object.keys(entry).sort()).toEqual(['model', 'name', 'shape']);
    }
  });

  it('reports a profile’s resolved model, so a tier and a full profile read the same way', () => {
    const profiles = listProfiles({ ...SERVER_ENV, CLODECK_PROVIDER_FAST_MODEL: 'haiku' });

    expect(summarizeProfiles(profiles, SERVER_ENV)).toEqual([
      { name: 'default', model: 'claude-opus-5-5', shape: 'tier' },
      { name: 'FAST', model: 'haiku', shape: 'tier' },
    ]);
  });

  it('is a provider when it declares an endpoint or a credential, and a tier when it declares neither', () => {
    const profiles = listProfiles({
      ...SERVER_ENV,
      CLODECK_PROVIDER_FAST_MODEL: 'haiku',
      CLODECK_PROVIDER_VENDOR_BASE_URL: 'https://vendor.example/anthropic',
      CLODECK_PROVIDER_KEYED_AUTH_TOKEN: 'a-credential',
    });

    // Classified by what it *declares*, not by what it resolves to: `FAST`
    // inherits the server's endpoint and credential all the same, and is still a
    // tier — a second model on the host the deployment already has. The reserved
    // default declares nothing, and is the same kind of thing.
    const shapes = Object.fromEntries(
      summarizeProfiles(profiles, SERVER_ENV).map((entry) => [entry.name, entry.shape]),
    );
    expect(shapes).toEqual({
      default: 'tier',
      FAST: 'tier',
      KEYED: 'provider',
      VENDOR: 'provider',
    });
  });
});

describe('the send rule', () => {
  /** A deployment with a provider of its own, and one profile of each shape. */
  const ENV: NodeJS.ProcessEnv = {
    ...SERVER_ENV,
    CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5',
    CLODECK_PROVIDER_VENDOR_BASE_URL: 'https://vendor.example/anthropic',
    CLODECK_PROVIDER_KEYED_AUTH_TOKEN: 'keyed-credential',
  };

  const PROFILES = listProfiles(ENV);

  /**
   * The eight subsets of the three keys a project's file may declare — the
   * ticket's own acceptance test. Built by folding the empty set and doubling it
   * per key, so the list cannot be short a case.
   */
  const SUBSETS: readonly (readonly string[])[] = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_MODEL',
  ].reduce<readonly string[][]>(
    (sets, key) => [...sets, ...sets.map((set) => [...set, key])],
    [[]],
  );

  /** A value for each key, so a declared key is a value and not a blank. */
  const VALUE: Record<string, string> = {
    ANTHROPIC_BASE_URL: 'https://project.example/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'project-credential',
    ANTHROPIC_MODEL: 'project-model',
  };

  function settingsDeclaring(keys: readonly string[]): unknown {
    return { env: Object.fromEntries(keys.map((key) => [key, VALUE[key]])) };
  }

  it('sends the whole trio, or the model alone — never a key from one source beside a key from the other', () => {
    for (const name of PROFILES.map((profile) => profile.name)) {
      const { provider } = resolveProfile(PROFILES, ENV, name);

      for (const keys of SUBSETS) {
        const pin = readPin(settingsDeclaring(keys));
        const { sent } = applyPin({ name, provider }, pin);
        const holds = keys.includes('ANTHROPIC_BASE_URL') || keys.includes('ANTHROPIC_AUTH_TOKEN');

        // One of two answers, for every profile against every subset. An empty
        // pair is not a third: it is the project's `env` outranking a key the
        // profile does not name at all.
        const expected = holds
          ? provider.model === undefined
            ? null
            : { model: provider.model }
          : provider;
        expect(sent, `${name} against [${keys.join(', ')}]`).toEqual(expected);

        // The pair itself, in the only two states it is allowed: both keys the
        // profile's, or neither. Every profile here resolves both, so an endpoint
        // arriving without its credential — the leak this rule exists to prevent
        // — would have to show up as a mixed pair right here.
        expect([sent?.baseUrl, sent?.authToken], `${name} against [${keys.join(', ')}]`).toEqual(
          holds ? [undefined, undefined] : [provider.baseUrl, provider.authToken],
        );
      }
    }
  });

  it('keeps the pair together when a project declares only one of the two', () => {
    // The two subsets a per-key rule leaks on: one key in the file is enough for
    // a credential to reach a host it was never issued for.
    for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) {
      const { provider } = resolveProfile(PROFILES, ENV, 'FAST');
      const { sent } = applyPin({ name: 'FAST', provider }, readPin(settingsDeclaring([key])));

      // Neither half of the pair travels, so neither can be crossed — and the
      // model does, which is the choice this leaves the session.
      expect(sent).toEqual({ model: 'claude-haiku-5-5' });
    }
  });

  it('sends the whole trio when the project declares a model and nothing else', () => {
    // A model in the file is not a pin: the model travels free, so a session's
    // choice still outranks it (ADR 0002).
    const { provider } = resolveProfile(PROFILES, ENV, 'FAST');
    const { sent, pin } = applyPin({ name: 'FAST', provider }, readPin(settingsDeclaring(['ANTHROPIC_MODEL'])));

    expect(pin).toBeNull();
    expect(sent).toEqual(provider);
  });

  it('sends nothing at all when a pinned project asks for a model the profile does not name', () => {
    // `Options.env` unset: the project's own `env` block and the ambient
    // environment then decide everything, which is what its pin asked for.
    const { sent } = applyPin(
      { name: 'BARE', provider: {} },
      readPin(settingsDeclaring(['ANTHROPIC_AUTH_TOKEN'])),
    );

    expect(sent).toBeNull();
  });
});

describe('the profiles route', () => {
  let sandbox: Sandbox;
  let root: string;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-profiles-');
    root = sandbox.root;
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  /**
   * A project directory, with a `.claude/settings.json` written as given — the
   * text, not an object, so a file that is not JSON is one this test can build.
   */
  async function project(name: string, settings?: string): Promise<string> {
    const dir = path.join(root, name);
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    if (settings !== undefined) {
      await writeFile(path.join(dir, '.claude', 'settings.json'), settings);
    }
    return realpath(dir);
  }

  /** The id the wire carries: base64url of the canonical directory. */
  function idFor(directory: string): string {
    return Buffer.from(directory, 'utf8').toString('base64url');
  }

  /** What one authenticated `GET /api/projects/:id/profiles` answers. */
  async function getProfiles(
    directory: string,
    env: NodeJS.ProcessEnv = SERVER_ENV,
  ): Promise<{ statusCode: number; body: unknown }> {
    const app = createTestApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      profiles: createProviderProfiles(env, () => undefined),
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${idFor(directory)}/profiles`,
        headers: { cookie: await login(app) },
      });
      return { statusCode: response.statusCode, body: response.json() };
    } finally {
      await app.close();
    }
  }

  it('hands the browser every profile’s name, model and shape, and nothing else', async () => {
    const directory = await project('plain');
    const response = await getProfiles(directory, {
      ...SERVER_ENV,
      CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5',
    });

    expect(response.statusCode).toBe(200);
    // Nothing is pinned: the project's file declares no provider, which is what
    // every project that pins nothing has in common.
    expect(response.body).toEqual({
      pinned: false,
      profiles: [
        { name: 'default', model: 'claude-opus-5-5', shape: 'tier' },
        { name: 'FAST', model: 'claude-haiku-5-5', shape: 'tier' },
      ],
    });
    // The endpoint and the credential are in the environment the response was
    // built from, and nowhere in the bytes: the list a client can read for
    // itself is exactly what it is allowed to read.
    expect(JSON.stringify(response.body)).not.toContain('gateway.example');
    expect(JSON.stringify(response.body)).not.toContain('server-credential');
  });

  it('reports a project that pins its provider, showing the endpoint it declares and never its credential', async () => {
    const directory = await project(
      'pinned',
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://vendor.example/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'project-credential',
        },
      }),
    );

    const response = await getProfiles(directory);

    expect(response.statusCode).toBe(200);
    // The endpoint goes to the browser because the user can read this same file
    // in the drawer (decision 14); the credential has no field to travel in, and
    // is asserted absent from the bytes rather than from a shape.
    expect(response.body).toEqual({
      pinned: true,
      endpoint: 'https://vendor.example/anthropic',
      profiles: [{ name: 'default', model: 'claude-opus-5-5', shape: 'tier' }],
    });
    expect(JSON.stringify(response.body)).not.toContain('project-credential');
  });

  it('reports a project that pins only its credential as pinned, with no endpoint to show', async () => {
    const directory = await project(
      'keyed',
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'project-credential' } }),
    );

    expect((await getProfiles(directory)).body).toEqual({
      pinned: true,
      profiles: [{ name: 'default', model: 'claude-opus-5-5', shape: 'tier' }],
    });
  });

  it('treats a file it cannot use as a project that pins nothing, rather than failing', async () => {
    // Not JSON, not an object, an `env` that is not an object, and an empty file:
    // one answer for all four, because a settings file must not be able to take a
    // turn down.
    const unusable = ['{ not json', '[]', JSON.stringify({ env: 'nope' }), ''];

    for (const [index, settings] of unusable.entries()) {
      const directory = await project(`broken-${String(index)}`, settings);

      const response = await getProfiles(directory);
      expect(response.statusCode, settings).toBe(200);
      expect(response.body, settings).toMatchObject({ pinned: false });
    }
  });

  it('answers 404 for an id that is not an allowlisted project', async () => {
    const response = await getProfiles(path.join(sandbox.dir, 'outside'));

    expect(response.statusCode).toBe(404);
  });

  it('is behind the same gate as every other route', async () => {
    const app = createTestApp({
      projects: createProjectDiscovery(root, { warn: () => undefined }),
      profiles: createProviderProfiles(SERVER_ENV, () => undefined),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/projects/anything/profiles' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
