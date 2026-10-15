import { describe, expect, it } from 'vitest';

import {
  createProviderProfiles,
  listProfiles,
  resolveProfile,
  summarizeProfiles,
  UnknownProfileError,
  type ProviderProfile,
} from './profiles.js';
import { createTestApp, login } from './test-support.js';

/**
 * The profile rules, against an environment object and nothing else: no server,
 * no key, no network (spec-08 §"The provider module"). What is pinned here is
 * the *external* behaviour — what an environment means, and what a name resolves
 * to — never a private helper.
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

  it('tells the client a name and a model, and nothing that could be a secret', () => {
    const profiles = createProviderProfiles(
      { ...SERVER_ENV, CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5' },
      () => undefined,
    );

    expect(profiles.list()).toEqual([
      { name: 'default', model: 'claude-opus-5-5' },
      { name: 'FAST', model: 'claude-haiku-5-5' },
    ]);

    // The whole payload, by key: an endpoint or a credential reaching a client
    // would be a field here, and there is nowhere for one to hide.
    for (const entry of profiles.list()) {
      expect(Object.keys(entry).sort()).toEqual(['model', 'name']);
    }
  });

  it('reports a profile’s resolved model, so a tier and a full profile read the same way', () => {
    const profiles = listProfiles({ ...SERVER_ENV, CLODECK_PROVIDER_FAST_MODEL: 'haiku' });

    expect(summarizeProfiles(profiles, SERVER_ENV)).toEqual([
      { name: 'default', model: 'claude-opus-5-5' },
      { name: 'FAST', model: 'haiku' },
    ]);
  });
});

describe('the profiles route', () => {
  /** What one authenticated `GET /api/profiles` answers. */
  async function getProfiles(env: NodeJS.ProcessEnv): Promise<{ statusCode: number; body: unknown }> {
    const app = createTestApp({ profiles: createProviderProfiles(env, () => undefined) });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/profiles',
        headers: { cookie: await login(app) },
      });
      return { statusCode: response.statusCode, body: response.json() };
    } finally {
      await app.close();
    }
  }

  it('hands the browser every profile’s name and model, and nothing else', async () => {
    const response = await getProfiles({
      ...SERVER_ENV,
      CLODECK_PROVIDER_FAST_MODEL: 'claude-haiku-5-5',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      profiles: [
        { name: 'default', model: 'claude-opus-5-5' },
        { name: 'FAST', model: 'claude-haiku-5-5' },
      ],
    });
    // The endpoint and the credential are in the environment the response was
    // built from, and nowhere in the bytes: the list a client can read for
    // itself is exactly what it is allowed to read.
    expect(JSON.stringify(response.body)).not.toContain('gateway.example');
    expect(JSON.stringify(response.body)).not.toContain('server-credential');
  });

  it('is behind the same gate as every other route', async () => {
    const app = createTestApp({ profiles: createProviderProfiles(SERVER_ENV, () => undefined) });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/profiles' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
