import {
  DEFAULT_PROFILE,
  type ProviderProfileShape,
  type ProviderProfileSummary,
  type ResolvedProvider,
} from '@clodeck/shared';
import type { FastifyInstance } from 'fastify';

import { envValue } from './config.js';
import type { ProjectDiscovery } from './discovery.js';
import { createScopedFs } from './files/scoped-fs.js';
import { warnToConsole, type Warn } from './logging.js';
import { isPinned, readProjectPin, type ProjectPin } from './project-pin.js';

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
 * A name is not the whole story. The project a session runs in may pin its own
 * provider in its `.claude/settings.json`, and the pin outranks a choice made
 * here key by key — so {@link applyPin} is what turns a resolved trio into the
 * keys a run actually carries, under the rule the ADR states: **the endpoint and
 * the credential travel together, and the model travels free**. `project-pin.ts`
 * reads the declaration; this file decides what follows from it.
 *
 * The route at the bottom of this file is the one door onto that list, and it is
 * deliberately a few lines that cannot be tempted: the client is told a name, a
 * model and a shape, and a {@link ProviderProfileSummary} has no field for an
 * endpoint or a credential to travel in.
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
 * The name, model and shape of every profile, for the picker.
 *
 * The model is the **resolved** one rather than the declared one, so the model
 * the picker shows and the model the run asks for are the same string by
 * construction — a tier that names a model and one that inherits it are told
 * apart by nothing on screen, which is the truth.
 *
 * The shape, by contrast, is read off what the profile **declares** (decision 9):
 * a profile that names an endpoint or a credential is a provider, and a pinned
 * project may not be offered it, however completely it resolves.
 */
export function summarizeProfiles(
  profiles: readonly ProviderProfile[],
  env: NodeJS.ProcessEnv,
): ProviderProfileSummary[] {
  return profiles.map((profile) => {
    const { model } = resolveProfile(profiles, env, profile.name).provider;
    const shape = shapeOf(profile);
    return model === undefined
      ? { name: profile.name, shape }
      : { name: profile.name, model, shape };
  });
}

/**
 * Which of the two words a profile is: **provider** when it declares the endpoint
 * or the credential, **tier** when it declares neither. The reserved default
 * declares nothing at all, and so is a tier — *whatever this server has* is a
 * model as far as a pinned project is concerned.
 */
function shapeOf(profile: ProviderProfile): ProviderProfileShape {
  return isPinned(profile.declared) ? 'provider' : 'tier';
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

/* -------------------------------------------------------------------------- */
/* The project's pin                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The profile one run carries, after the project it runs in has had its say: the
 * name the session chose, the keys this run's environment will actually carry
 * from clodeck, and the pin that kept the rest.
 *
 * It exists because a choice and its outcome stopped being the same thing the
 * moment a project could pin a provider — and because the line that records
 * "what did that turn run on" has to be able to say which of the two it is
 * seeing.
 */
export interface RunProfile {
  /** The profile the session chose, by the name it chose it by. */
  name: string;
  /**
   * The keys clodeck puts on the run's environment. `null` when it puts none:
   * a pinned project asking for a model the profile does not name leaves
   * clodeck with nothing to send at all.
   */
  sent: ResolvedProvider | null;
  /**
   * The project's pin, when it kept the endpoint and the credential to itself;
   * `null` when the run carries the profile's — which is also what a project
   * that declares nothing gives.
   */
  pin: ProjectPin | null;
}

/**
 * The send rule (`docs/adr/0002-…`, decision 8): what a run carries, given the
 * profile a session chose and the pin the project declares.
 *
 * Two answers, and never a third. A project that declares **neither** the
 * endpoint nor the credential gets the whole resolved trio. A project that
 * declares **either** keeps both — they travel together — and the run carries
 * the **model alone**, which is what leaves the cheap/strong choice alive inside
 * a project whose billing is fixed.
 *
 * The pair is the point. The SDK's own precedence is per key, so supplying the
 * profile's endpoint beside a credential the project file won would be a
 * credential delivered to a host it was never issued for, with no warning at all
 * — and supplying the profile's credential beside the project's endpoint is the
 * same mistake facing the other way. So clodeck supplies both or neither.
 */
export function applyPin(profile: ResolvedProfile, pin: ProjectPin): RunProfile {
  const { name, provider } = profile;

  if (!isPinned(pin)) return { name, sent: provider, pin: null };

  return {
    name,
    sent: provider.model === undefined ? null : { model: provider.model },
    pin,
  };
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
 * `GET /api/projects/:id/profiles`: the whole of what the picker is told.
 *
 * The list is the server's, not the project's — an operator's profiles are the
 * deployment's — but the *pin* is the project's, which is why this route hangs
 * off one project rather than standing beside them: what a session in this
 * project may choose is not the same answer as what a session elsewhere may.
 *
 * It sits beside the rules it serves because the one thing a reader has to be
 * able to check about it is what leaves the server, which is easier to check with
 * the list's own type in the same file: a name, a model and a shape per profile,
 * and of the pin only the endpoint — the half a browser may be shown, because the
 * user can read the same file in the drawer (decision 14). The credential is not
 * in the file's declaration this route hands on, and a test asserts the bytes.
 *
 * Registered into the app's gated `/api` scope, so it is authenticated by where
 * it sits rather than by a rule of its own; `:id` re-enters `resolveProject`, the
 * only place an id becomes a directory.
 */
export function registerProfileRoutes(
  api: FastifyInstance,
  options: { projects: ProjectDiscovery; profiles: ProviderProfiles },
): void {
  api.get<{ Params: { id: string } }>('/projects/:id/profiles', async (request, reply) => {
    const project = await options.projects.resolveProject(request.params.id);
    if (project === null) {
      return reply.code(404).send({ error: 'no allowlisted project matches this id' });
    }

    const pin = await readProjectPin(createScopedFs(project.path));
    return {
      pinned: isPinned(pin),
      ...(pin.baseUrl === undefined ? {} : { endpoint: pin.baseUrl }),
      profiles: options.profiles.list(),
    };
  });
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
