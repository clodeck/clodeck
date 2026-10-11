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
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const warn = options.warn ?? warnToConsole;

  return {
    projectsRoot: projectsRoot(env, options.configPath, warn),
    uiPassword: uiPassword(env, warn),
  };
}

function projectsRoot(
  env: NodeJS.ProcessEnv,
  configPathOption: string | undefined,
  warn: Warn,
): string | null {
  const fromEnv = env['PROJECTS_ROOT']?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
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
  const fromEnv = env['UI_PASSWORD']?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  const file = env['UI_PASSWORD_FILE']?.trim();
  if (file === undefined || file === '') return null;

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
