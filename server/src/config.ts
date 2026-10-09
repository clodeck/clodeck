import { readFileSync } from 'node:fs';
import path from 'node:path';

import { warnToConsole, type Warn } from './logging.js';

export interface ServerConfig {
  /** The projects root, or null when nothing is configured (an empty list, never an error). */
  projectsRoot: string | null;
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
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const warn = options.warn ?? warnToConsole;

  const fromEnv = env['PROJECTS_ROOT']?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
    return { projectsRoot: path.resolve(fromEnv) };
  }

  const configPath = options.configPath ?? path.join(process.cwd(), CONFIG_FILE_NAME);
  const fromFile = projectsRootFromFile(configPath, warn);
  return { projectsRoot: fromFile === null ? null : path.resolve(fromFile) };
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
