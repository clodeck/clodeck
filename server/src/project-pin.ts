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
 * malformed file from taking a server down. {@link readProjectSettings} is the
 * one that touches a disk, and it goes through the project's own
 * {@link ScopedFs} rather than a bare `fs` beside it.
 *
 * Since ticket 85 the same file is read for a second fact — whether it forbids
 * **Bypass** — so the disk half returns both at once ({@link readSettings}).
 * `readProjectPin` is kept as the provider-only door for the profile listing,
 * which asks nothing about permissions.
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
 * What a project's settings file says about the two things clodeck gates on it:
 * the provider the project pins (ADR 0002), and whether it forbids **Bypass**
 * (ticket 85). One shape, because it is one file and one read — two readers
 * would be two parses of the same document, and a chance for them to disagree
 * about a file that is half-written mid-edit.
 */
export interface ProjectSettings {
  pin: ProjectPin;
  /**
   * True when `permissions.disableBypassPermissionsMode` is `"disable"`. The SDK
   * enforces the same value itself; this is what lets clodeck refuse the mode
   * with a reason *before* a run starts, and tell the client why its chip is
   * shut.
   */
  bypassDisabled: boolean;
}

/** What a file clodeck cannot use says: no pin, and nothing about Bypass. */
const NO_SETTINGS: ProjectSettings = { pin: NO_PIN, bypassDisabled: false };

/**
 * A parsed settings document as {@link ProjectSettings}. Only the SDK's own
 * `"disable"` counts — the field is a one-value switch there, and a value it
 * would not honour must not be read as a refusal here either.
 */
export function readSettings(settings: unknown, warn: Warn = warnToConsole): ProjectSettings {
  return { pin: readPin(settings, warn), bypassDisabled: disablesBypass(settings) };
}

/** The SDK's one-value switch, read without warning: a file about permissions is normal. */
function disablesBypass(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return false;

  const permissions = (settings as { permissions?: unknown }).permissions;
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) {
    return false;
  }

  return (
    (permissions as { disableBypassPermissionsMode?: unknown }).disableBypassPermissionsMode ===
    'disable'
  );
}

/**
 * The settings a project declares right now, read through the same
 * {@link ScopedFs} every other read of a project's files goes through —
 * realpath'd, and confirmed inside the project root — rather than a second `fs`
 * with its own idea of where the project ends (spec-08 §"Reading the project's
 * pin").
 *
 * Nothing here may take a session down, so every way this file can be unusable
 * means {@link NO_SETTINGS}: not readable as text, not JSON, or JSON of the
 * wrong shape. An **absent** file is the common case rather than a finding —
 * most projects pin nothing, and a line per turn for each of them would bury the
 * lines that matter (the same silence `listProfiles` keeps for an empty export).
 *
 * Read per call, not cached: the file is the project's, the user may edit it in
 * the drawer, and a turn that starts after the edit is a turn that should honour
 * it — for the pin and for Bypass alike.
 */
export async function readProjectSettings(
  files: ScopedFs,
  warn: Warn = warnToConsole,
): Promise<ProjectSettings> {
  const settings = await files.resolve(SETTINGS_PATH);
  if (settings.status === 'not_found') return NO_SETTINGS;
  if (settings.status !== 'ok' || settings.kind !== 'file') {
    warn(`${SETTINGS_PATH} is not a file inside this project, so this project declares no settings`);
    return NO_SETTINGS;
  }

  const content = await files.readFile(settings.scoped);
  if (content.kind !== 'text') {
    warn(`${SETTINGS_PATH} is not readable text, so this project declares no settings`);
    return NO_SETTINGS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.content);
  } catch {
    warn(`${SETTINGS_PATH} is not valid JSON, so this project declares no settings`);
    return NO_SETTINGS;
  }

  return readSettings(parsed, warn);
}

/** The pin a project declares right now — the provider half of {@link readProjectSettings}. */
export async function readProjectPin(files: ScopedFs, warn: Warn = warnToConsole): Promise<ProjectPin> {
  return (await readProjectSettings(files, warn)).pin;
}
