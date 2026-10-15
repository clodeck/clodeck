import { envValue } from './config.js';
import type { ScopedFs } from './files/scoped-fs.js';
import { warnToConsole, type Warn } from './logging.js';

/**
 * The project's pin (GLOSSARY: *pinned project*): what a project's own
 * `.claude/settings.json` declares about the provider, and the reason a session's
 * choice can be narrowed to a model
 * (`docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`).
 *
 * A project directory is **already** a provider channel — the SDK loads this file
 * (`settingSources: ['project']`, which is also what loads `CLAUDE.md`) and its
 * `env` block outranks the server process's own `ANTHROPIC_*`. Nothing here
 * fights that: this module only *reads* the file, so the rule that watches the
 * pair can be applied to what the project says.
 *
 * The reading is split in two on purpose. {@link readPin} is a pure function of
 * the parsed file, and what it does with a value it cannot use is what keeps a
 * malformed file from taking a server down. {@link readProjectPin} is the one
 * that touches a disk, and it goes through the project's own {@link ScopedFs}
 * rather than a bare `fs` beside it.
 */

/** Where a project states the environment its own runs get. */
const SETTINGS_PATH = '.claude/settings.json';

/**
 * What the file declares, by the three keys it may name — and **only** the keys
 * it names, the idiom `ProviderProfile.declared` uses: an absent key is not a
 * blank but a key the project says nothing about.
 *
 * `model` is here because it is one of the three keys a file may declare, not
 * because it is part of the pin: the model travels free (ADR 0002), which is why
 * {@link isPinned} asks about the other two.
 */
export interface ProjectPin {
  /** `ANTHROPIC_BASE_URL`: the endpoint this project's runs go to. */
  baseUrl?: string;
  /** `ANTHROPIC_AUTH_TOKEN`: the credential those runs carry. */
  authToken?: string;
  /** `ANTHROPIC_MODEL`: what the file asks for. A session's choice still outranks it. */
  model?: string;
}

/** What a file clodeck cannot use declares: nothing. */
export const NO_PIN: ProjectPin = {};

/**
 * A declaration that names the endpoint or the credential — either one alone, and
 * either one is enough: that is the whole reason the pair has to travel together.
 *
 * It is one predicate answering one question, *does this claim a host of its
 * own?*, about the two places that ask it. For a project's pin, yes means
 * **pinned project**. For a profile's `declared` keys — the same three keys, the
 * same idiom — yes means **provider** rather than *tier* (decision 9), which is
 * what stops a pinned project being offered it.
 */
export function isPinned(pin: ProjectPin): boolean {
  return pin.baseUrl !== undefined || pin.authToken !== undefined;
}

/**
 * Which keys a parsed `.claude/settings.json` declares.
 *
 * Everything that is not a plain object with an object `env` means **no pin**: an
 * array or a bare number as the whole document, an `env` that is a string or a
 * list. Those are reported, because a file that declares nothing and a file that
 * fails to declare something look identical from the outside. A blank value is
 * the other case, and a quiet one — `"ANTHROPIC_MODEL": ""` is a line that says
 * nothing, exactly as an empty export does, by the one definition of unset that
 * `config.ts` owns.
 */
export function readPin(settings: unknown, warn: Warn = warnToConsole): ProjectPin {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    warn(`${SETTINGS_PATH} is not a JSON object, so this project pins no provider`);
    return NO_PIN;
  }

  const env = (settings as { env?: unknown }).env;
  // A file that carries no `env` at all is a valid file about other things —
  // permissions, hooks, a model — and there is nothing to report about it.
  if (env === undefined) return NO_PIN;
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    warn(`${SETTINGS_PATH} declares an env that is not an object, so this project pins no provider`);
    return NO_PIN;
  }

  const block = asEnvironment(env as Record<string, unknown>);
  const pin: ProjectPin = {};

  const baseUrl = envValue(block, 'ANTHROPIC_BASE_URL');
  if (baseUrl !== null) pin.baseUrl = baseUrl;
  const authToken = envValue(block, 'ANTHROPIC_AUTH_TOKEN');
  if (authToken !== null) pin.authToken = authToken;
  const model = envValue(block, 'ANTHROPIC_MODEL');
  if (model !== null) pin.model = model;

  return pin;
}

/**
 * A file's `env` block as the shape `envValue` reads: the values that could have
 * come from an environment at all. A number, a list or a nested object inside it
 * is not something a shell could have exported, so it declares nothing — and the
 * blank-value rule stays `config.ts`'s one definition of unset, applied to this
 * map exactly as it is to the process's own.
 */
function asEnvironment(block: Record<string, unknown>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(block)) {
    if (typeof value === 'string') environment[key] = value;
  }
  return environment;
}

/**
 * The pin a project declares right now, read through the same {@link ScopedFs}
 * every other read of a project's files goes through — realpath'd, and confirmed
 * inside the project root — rather than a second `fs` with its own idea of where
 * the project ends (spec-08 §"Reading the project's pin").
 *
 * Nothing here may take a session down, so every way this file can be unusable
 * means no pin: not readable as text, not JSON, or JSON of the wrong shape. An
 * **absent** file is the common case rather than a finding — most projects pin
 * nothing, and a line per turn for each of them would bury the lines that matter
 * (the same silence `listProfiles` keeps for an empty export).
 *
 * Read per call, not cached: the file is the project's, the user may edit it in
 * the drawer, and a turn that starts after the edit is a turn that should honour
 * it.
 */
export async function readProjectPin(files: ScopedFs, warn: Warn = warnToConsole): Promise<ProjectPin> {
  const settings = await files.resolve(SETTINGS_PATH);
  if (settings.status === 'not_found') return NO_PIN;
  if (settings.status !== 'ok' || settings.kind !== 'file') {
    warn(`${SETTINGS_PATH} is not a file inside this project, so it pins no provider`);
    return NO_PIN;
  }

  const content = await files.readFile(settings.scoped);
  if (content.kind !== 'text') {
    warn(`${SETTINGS_PATH} is not readable text, so this project pins no provider`);
    return NO_PIN;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.content);
  } catch {
    warn(`${SETTINGS_PATH} is not valid JSON, so this project pins no provider`);
    return NO_PIN;
  }

  return readPin(parsed, warn);
}
