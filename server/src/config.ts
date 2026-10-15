import { readFileSync } from 'node:fs';
import path from 'node:path';

import { warnToConsole, type Warn } from './logging.js';

export interface ServerConfig {
  /** The projects root, or null when nothing is configured (an empty list, never an error). */
  projectsRoot: string | null;
  /**
   * The single account's password, or null when nothing is configured. Null is
   * a *valid* state and a loud one: the server boots fail-closed, so every
   * gated route and socket answers 401 (spec-05 §"Config + main wiring").
   */
  uiPassword: string | null;
  /**
   * The built web client's directory, or null when the server serves no client
   * — the dev loop, where Vite serves it (spec-06 §"Ticket 27").
   */
  webRoot: string | null;
  /**
   * The origin a browser reaches the app at, or null when the operator has not
   * declared one (spec-07 §"The public origin"). Declaring it is what lets a
   * deployment with no domain keep a session: its scheme decides whether the
   * session cookie can be `Secure`, which the app otherwise cannot know — a
   * proxy terminating TLS makes the app's own origin and the browser's differ.
   */
  publicOrigin: string | null;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Defaults to `clodeck.config.json` in the working directory. */
  configPath?: string;
  warn?: Warn;
}

const CONFIG_FILE_NAME = 'clodeck.config.json';

/**
 * The projects root: `PROJECTS_ROOT` first (the Docker-friendly way, wayfinder
 * 05 §1), then a config file's `projectsRoot` for deployments that would
 * rather not export an env var. Unconfigured is a valid state — discovery
 * answers with an empty list and the misconfiguration is logged.
 *
 * The password is a sibling of that, and reads from the environment only:
 * `UI_PASSWORD` first, then `UI_PASSWORD_FILE` (the Docker-secret-friendly
 * way). It is never written to the config file, because the point of the file
 * is convenience and the point of the password is not to be in one.
 *
 * `WEB_ROOT` is env-only for the same reason: it names the build artifact the
 * image produced (spec-06 §"Ticket 27"), which is not a thing an operator keeps
 * in a convenience file.
 *
 * `CLODECK_PUBLIC_URL` — the origin a browser reaches the app at — is the third
 * of that kind (spec-07). It is a deployment fact rather than a preference, and
 * it is the one nothing else in the process can supply.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const warn = options.warn ?? warnToConsole;

  return {
    projectsRoot: projectsRoot(env, options.configPath, warn),
    uiPassword: uiPassword(env, warn),
    webRoot: webRoot(env),
    publicOrigin: publicOrigin(env),
  };
}

/**
 * An environment variable's value, trimmed, or null when it is unset or blank.
 * The one place "unset" is defined: an exported-but-empty variable is a shell
 * accident rather than a declaration, and every reader here has to agree about
 * that or the same deployment would mean two things.
 */
function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? null : value;
}

/**
 * The origin a browser reaches the app at, or null when nothing is declared.
 * Environment-only, like the other two deployment facts: it describes *this*
 * deployment — its address, its TLS — not a preference, and it must be readable
 * before the app has an address of its own.
 *
 * It is deliberately not validated here. Reading the environment is this
 * function's whole job; whether the value can decide a cookie's flag is the
 * cookie's business (see `auth/transport.ts`), which is where a typo is
 * reported.
 */
function publicOrigin(env: NodeJS.ProcessEnv): string | null {
  return envValue(env, 'CLODECK_PUBLIC_URL');
}

/**
 * The built client's directory, or null. Environment-only, like the password:
 * it names a build artifact the image produced, not a preference an operator
 * would keep in a config file. An unset `WEB_ROOT` is what keeps the Vite dev
 * loop's behavior unchanged.
 */
function webRoot(env: NodeJS.ProcessEnv): string | null {
  const fromEnv = envValue(env, 'WEB_ROOT');
  return fromEnv === null ? null : path.resolve(fromEnv);
}

function projectsRoot(
  env: NodeJS.ProcessEnv,
  configPathOption: string | undefined,
  warn: Warn,
): string | null {
  const fromEnv = envValue(env, 'PROJECTS_ROOT');
  if (fromEnv !== null) {
    return path.resolve(fromEnv);
  }

  const configPath = configPathOption ?? path.join(process.cwd(), CONFIG_FILE_NAME);
  const fromFile = projectsRootFromFile(configPath, warn);
  return fromFile === null ? null : path.resolve(fromFile);
}

/**
 * The configured password, trimmed, or null. A blank value counts as unset —
 * exporting an empty variable is a mistake, not a credential of "" — and a
 * file that cannot be read is reported rather than silently ignored, because
 * the operator's next symptom would be "the password I set does not work".
 */
function uiPassword(env: NodeJS.ProcessEnv, warn: Warn): string | null {
  const fromEnv = envValue(env, 'UI_PASSWORD');
  if (fromEnv !== null) return fromEnv;

  const file = envValue(env, 'UI_PASSWORD_FILE');
  if (file === null) return null;

  let contents: string;
  try {
    contents = readFileSync(file, 'utf8').trim();
  } catch (error) {
    warn(`could not read UI_PASSWORD_FILE ${file}: ${String(error)}`);
    return null;
  }

  if (contents === '') {
    warn(`ignoring UI_PASSWORD_FILE ${file}: the file is empty`);
    return null;
  }

  return contents;
}

/**
 * The `projectsRoot` string in the config file, or null when it cannot be
 * used. Only a file that exists but is unusable is reported: an absent config
 * file is the normal case.
 */
function projectsRootFromFile(configPath: string, warn: Warn): string | null {
  let contents: string;
  try {
    contents = readFileSync(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`could not read config ${configPath}: ${String(error)}`);
    }
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    warn(`ignoring config ${configPath}: not valid JSON (${String(error)})`);
    return null;
  }

  const candidate =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)['projectsRoot']
      : undefined;

  if (typeof candidate === 'string' && candidate.trim() !== '') {
    return candidate;
  }

  if (candidate !== undefined) {
    warn(`ignoring config ${configPath}: "projectsRoot" must be a non-empty string`);
  }

  return null;
}
