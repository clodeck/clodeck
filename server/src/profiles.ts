import { DEFAULT_PROFILE, type ProviderProfileSummary, type ResolvedProvider } from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';

import { envValue } from './config.js';
import { warnToConsole, type Warn } from './logging.js';

/**
 * The provider profiles: a session's choice of which provider it runs on
 * (spec-08 §"The provider module",
 * `docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`).
 *
 * A profile is a **patch** over this server's environment, declared as
 * `CLODECK_PROVIDER_<NAME>_BASE_URL` / `_AUTH_TOKEN` / `_MODEL`. It may declare
 * any subset of the three and inherits the rest, which is what makes a tier —
 * a second model on the same endpoint and credential — one line of
 * configuration. The reserved **default** profile is this server's own
 * environment, so a deployment that declares nothing behaves exactly as it did
 * before a run could choose.
 *
 * Reading the environment is a pure function of it, like `loadConfig`, and
 * nothing here imports the SDK: what a run *does* with a resolved trio is
 * `sdk/`'s business, and the tests of these rules need no key, no network and no
 * server.
 *
 * The route at the bottom of this file is the one door onto that list, and it is
 * deliberately three lines that cannot be tempted: the client is told a name and
 * a model, and a {@link ProviderProfileSummary} has no field for an endpoint or
 * a credential to travel in.
 */

/** The namespace a profile is declared in. */
const PREFIX = 'CLODECK_PROVIDER_';

/**
 * The three keys a profile may declare, by the suffix that names each one. The
 * `satisfies` is the link back to `ResolvedProvider`: a fourth provider field
 * would fail the build here rather than go silently unsupported.
 */
const DECLARABLE = {
  BASE_URL: 'baseUrl',
  AUTH_TOKEN: 'authToken',
  MODEL: 'model',
} as const satisfies Record<string, keyof ResolvedProvider>;

/** The reserved name as a declaration meets it, after normalization. */
const RESERVED = DEFAULT_PROFILE.toUpperCase();

/** The suffixes above, for the line that says what a profile may declare. */
const DECLARABLE_KEYS = `_${Object.keys(DECLARABLE).join(', _')}`;

/**
 * One declared profile: its name, and **only** the keys it declares itself. What
 * it leaves out is not a blank but an inheritance, filled in at resolution.
 */
export interface ProviderProfile {
  name: string;
  declared: ResolvedProvider;
}

/**
 * A profile resolved for one run: the name it was chosen by, and the complete
 * trio it runs on. The name is here because a run's log line is about the
 * choice a person made, and the trio alone would not name it.
 */
export interface ResolvedProfile {
  name: string;
  provider: ResolvedProvider;
}

/**
 * The profiles this server offers, as one value.
 *
 * Reading the environment once, here, is the whole point of the shape: the set
 * cannot change under a running session, and a changed environment is a restart
 * — the same deliberate act as changing the password hash (decision 13).
 */
export interface ProviderProfiles {
  /** Every profile's name and model. Never an endpoint, never a credential. */
  list(): readonly ProviderProfileSummary[];
  /** The complete trio for `name`, or the reserved default when none is named. */
  resolve(name?: string): ResolvedProfile;
}

/**
 * Refused rather than defaulted. The client's name is untrusted, and a browser
 * that remembers a profile an operator has since removed must be told so: a
 * silent fall back to the default would run a turn on a provider nobody chose,
 * which is the one thing a visibility rule cannot survive.
 */
export class UnknownProfileError extends Error {
  constructor(readonly profileName: string) {
    super(`no provider profile named "${profileName}"`);
    this.name = 'UnknownProfileError';
  }
}

/**
 * Every profile this environment declares, plus the reserved default, in
 * alphabetical order.
 *
 * A key under the prefix that is not one of the three suffixes — or that names
 * no profile at all — is a typo doing nothing, so it is reported rather than
 * silently skipped. A blank value is not a declaration (`config.ts`'s one
 * definition of unset): `CLODECK_PROVIDER_FAST_MODEL=` declares nothing, and a
 * name whose keys are all blank is a name this list does not carry.
 */
export function listProfiles(env: NodeJS.ProcessEnv, warn: Warn = warnToConsole): ProviderProfile[] {
  const declared = new Map<string, ResolvedProvider>();

  for (const key of Object.keys(env)) {
    if (!key.startsWith(PREFIX)) continue;

    const parsed = parseDeclaration(key.slice(PREFIX.length));
    if (parsed === null) {
      warn(`ignoring ${key}: a provider profile declares ${DECLARABLE_KEYS}`);
      continue;
    }

    // A blank value is no declaration at all: `config.ts` owns the definition of
    // unset, and a key exported empty is skipped exactly like one never set.
    const value = envValue(env, key);
    if (value === null) continue;

    // The reserve holds: a declaration of the reserved name is reported rather
    // than obeyed, so `default` goes on meaning this server's own environment.
    if (parsed.name === RESERVED) {
      warn(`ignoring ${key}: "${DEFAULT_PROFILE}" is reserved for this server's own environment`);
      continue;
    }

    const profile = declared.get(parsed.name) ?? {};
    profile[parsed.field] = value;
    declared.set(parsed.name, profile);
  }

  return [
    { name: DEFAULT_PROFILE, declared: {} },
    ...[...declared].map(([name, keys]) => ({ name, declared: keys })),
  ].sort(byName);
}

/**
 * The name and model of every profile, for the picker.
 *
 * The model is the **resolved** one rather than the declared one, so the model
 * the picker shows and the model the run asks for are the same string by
 * construction — a tier that names a model and one that inherits it are told
 * apart by nothing on screen, which is the truth.
 */
export function summarizeProfiles(
  profiles: readonly ProviderProfile[],
  env: NodeJS.ProcessEnv,
): ProviderProfileSummary[] {
  return profiles.map((profile) => {
    const { model } = resolveProfile(profiles, env, profile.name).provider;
    return model === undefined ? { name: profile.name } : { name: profile.name, model };
  });
}

/**
 * The complete trio one profile runs on: what it declares, laid over what this
 * server's environment already is.
 *
 * Complete is not the same as filled: a key neither source has stays absent, and
 * absent means *the endpoint decides* (decision 13), not "missing, invent one".
 * What the resolution guarantees is narrower and is the point of it — no key is
 * ever answered by a mix of the two sources.
 */
export function resolveProfile(
  profiles: readonly ProviderProfile[],
  env: NodeJS.ProcessEnv,
  name: string,
): ResolvedProfile {
  const profile = profiles.find((candidate) => candidate.name === name);
  if (profile === undefined) throw new UnknownProfileError(name);

  const provider: ResolvedProvider = {
    ...inheritedProvider(env),
    ...declaredKeys(profile.declared),
  };

  return { name, provider };
}

/**
 * The profiles, read once. The environment is read at construction and never
 * again, so a profile cannot appear or change under a session that is already
 * running (decision 13).
 */
export function createProviderProfiles(
  env: NodeJS.ProcessEnv = process.env,
  warn: Warn = warnToConsole,
): ProviderProfiles {
  const profiles = listProfiles(env, warn);
  const summaries = summarizeProfiles(profiles, env);

  return {
    list() {
      return summaries;
    },
    resolve(name) {
      return resolveProfile(profiles, env, name ?? DEFAULT_PROFILE);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The route                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/profiles`: the whole of what the picker is told.
 *
 * It sits beside the rules it serves because it *is* three lines — and because
 * the one thing a reader has to be able to check about it is that nothing but a
 * name and a model leaves the server, which is easier to check with the list's
 * own type in the same file. Registered into the app's gated `/api` scope, so it
 * is authenticated by where it sits rather than by a rule of its own.
 */
export function registerProfileRoutes(api: FastifyInstance, options: { profiles: ProviderProfiles }): void {
  api.get('/profiles', async () => ({ profiles: options.profiles.list() }));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A key's declaration, or null when it is not one. The suffix decides which of
 * the three keys this is; what remains is the name, normalized so that a name an
 * operator writes the way it is *spoken* — `deepseek-flash` — and the one a shell
 * can actually export — `DEEPSEEK_FLASH` — are one profile rather than two.
 */
function parseDeclaration(suffix: string): { name: string; field: keyof ResolvedProvider } | null {
  for (const [suffixName, field] of Object.entries(DECLARABLE)) {
    if (!suffix.endsWith(`_${suffixName}`)) continue;

    const name = normalize(suffix.slice(0, suffix.length - suffixName.length - 1));
    return name === '' ? null : { name, field };
  }
  return null;
}

/** One profile's name, spelled one way: upper case, and `-` folded to `_`. */
function normalize(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}

/**
 * What this server's own environment already is: the three variables the Agent
 * SDK reads. These are the default profile's whole declaration, and every other
 * profile's inheritance.
 */
function inheritedProvider(env: NodeJS.ProcessEnv): ResolvedProvider {
  return {
    baseUrl: envValue(env, 'ANTHROPIC_BASE_URL') ?? undefined,
    authToken: envValue(env, 'ANTHROPIC_AUTH_TOKEN') ?? undefined,
    model: envValue(env, 'ANTHROPIC_MODEL') ?? undefined,
  };
}

/**
 * Only the keys a profile declares. Spreading `declared` directly would carry an
 * explicit `undefined` over an inherited value the moment one exists, which is
 * the difference between a profile that says nothing about the endpoint and one
 * that says the endpoint is nothing.
 */
function declaredKeys(declared: ResolvedProvider): ResolvedProvider {
  const keys: ResolvedProvider = {};
  if (declared.baseUrl !== undefined) keys.baseUrl = declared.baseUrl;
  if (declared.authToken !== undefined) keys.authToken = declared.authToken;
  if (declared.model !== undefined) keys.model = declared.model;
  return keys;
}

/**
 * Alphabetical, case-insensitively, so the reserved lowercase `default` sorts
 * among the operator's names rather than after every one of them — the order a
 * reader expects of a list they scan (and the one `discovery.ts` orders projects
 * by).
 */
function byName(left: ProviderProfile, right: ProviderProfile): number {
  return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
}
