import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { PermissionMode } from '@clodeck/shared';

import { warnToConsole, type Warn } from './logging.js';
import { trustedProxyList } from './trusted-proxies.js';

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
   * — the dev loop, where Vite serves it (spec-06 §"Ticket 27"). An unset
   * `WEB_ROOT` resolves to a build this repo made, when there is one; see
   * {@link resolveWebRoot}.
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
  /**
   * The proxies whose forwarded address the app believes —
   * `CLODECK_TRUSTED_PROXIES`, already checked and normalized — or null when
   * nothing is trusted (ticket 65). Unset is the behaviour every deployment had
   * before this variable existed; declared, it is what lets the login limiter
   * count failures against the browser's address rather than the proxy's, which
   * is otherwise one bucket shared by everyone behind it.
   */
  trustedProxies: string | null;
  /**
   * The permission mode a session starts in when it has chosen none, read once
   * at boot from `CLODECK_PERMISSION_MODE` (ticket 82). The session may
   * override it; a New chat goes back to this value rather than to an SDK
   * default, which is why it is configuration and not a constant.
   */
  permissionMode: PermissionMode;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Defaults to `clodeck.config.json` in the working directory. */
  configPath?: string;
  /**
   * The working directory both defaults are read from: the config file's name,
   * and the walk for a built client when `WEB_ROOT` is unset. Injectable for the
   * same reason the projects root and the env are — a test of what an unset
   * `WEB_ROOT` resolves to must not depend on where the suite happens to run,
   * which would also mean depending on this machine's own build output
   * (spec-07 §"The web root").
   */
  cwd?: string;
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
 * in a convenience file. Unset, a build this repo made is found by walking up
 * from the working directory (spec-07 §"The web root"), so an operator who has
 * built the client need not also say where it went.
 *
 * `CLODECK_PUBLIC_URL` — the origin a browser reaches the app at — is the third
 * of that kind (spec-07). It is a deployment fact rather than a preference, and
 * it is the one nothing else in the process can supply.
 *
 * `CLODECK_TRUSTED_PROXIES` — the proxies in front of this deployment — is the
 * fourth (ticket 65), and it is environment-only for the same reason: whether a
 * hop in front of the app is one the operator put there is known outside the
 * process or nowhere.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const warn = options.warn ?? warnToConsole;
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? path.join(cwd, CONFIG_FILE_NAME);

  return {
    projectsRoot: projectsRoot(env, configPath, warn),
    uiPassword: uiPassword(env, warn),
    webRoot: webRoot(env, cwd, warn),
    publicOrigin: publicOrigin(env),
    // The one value here that is checked on the way through, and for one reason:
    // it is handed to Fastify, which throws on a list it cannot compile. A typo
    // would cost the operator a boot rather than a warning, so it is caught at
    // the door every config comes through (`trusted-proxies.ts`).
    trustedProxies: trustedProxyList(envValue(env, 'CLODECK_TRUSTED_PROXIES'), warn),
    // The one value here that is refused rather than warned about: a mode the
    // contract does not offer is a promise the UI cannot keep, so the process
    // stops at boot instead of running every turn in a mode nobody chose.
    permissionMode: permissionModeFromEnv(env),
  };
}

/**
 * The modes a deployment may choose as its default. `auto` and `dontAsk` are
 * refused for good: `dontAsk` never calls `canUseTool`, so a refusal would look
 * like a hang, and `auto`'s classifier is not observable from the UI (ADR
 * 0003). `bypassPermissions` joins this set when ticket 85 lands its gates.
 *
 * `satisfies Partial<Record<PermissionMode, true>>` keeps each key a member of
 * the shared union: a renamed or invented mode fails the build here rather than
 * reaching a run.
 */
const BOOT_PERMISSION_MODES = {
  default: true,
  acceptEdits: true,
  plan: true,
} satisfies Partial<Record<PermissionMode, true>>;

/**
 * `CLODECK_PERMISSION_MODE`, or Ask when it is unset or blank. A value outside
 * {@link BOOT_PERMISSION_MODES} throws: this is the one misconfiguration whose
 * symptom would be a session quietly running under a policy the operator did
 * not pick, so it is stopped at the door rather than reported and ignored.
 */
export function permissionModeFromEnv(env: NodeJS.ProcessEnv): PermissionMode {
  const declared = envValue(env, 'CLODECK_PERMISSION_MODE');
  if (declared === null) return 'default';

  if (Object.hasOwn(BOOT_PERMISSION_MODES, declared)) {
    return declared as keyof typeof BOOT_PERMISSION_MODES;
  }

  const unavailable =
    declared === 'bypassPermissions' ? ' — Bypass is not available yet (ticket 85)' : '';
  throw new Error(
    `CLODECK_PERMISSION_MODE is "${declared}"; use one of ` +
      `${Object.keys(BOOT_PERMISSION_MODES).join(', ')}${unavailable}`,
  );
}

/**
 * An environment variable's value, trimmed, or null when it is unset or blank.
 * The one place "unset" is defined: an exported-but-empty variable is a shell
 * accident rather than a declaration, and every reader here has to agree about
 * that or the same deployment would mean two things.
 *
 * Exported because the provider profiles read the same `ANTHROPIC_*` variables
 * this module reads (`profiles.ts`): "unset" has to mean one thing in both, or a
 * blank `ANTHROPIC_MODEL` would be unset for the deployment and set for a
 * profile.
 */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
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
 * would keep in a config file.
 *
 * An explicit `WEB_ROOT` is the operator saying where the build is, so nothing
 * is looked for and nothing is reported. Unset, the walk below is what makes
 * `GET /` the app in a checkout nobody configured — and its outcome is reported
 * either way, because the silent 404 it replaces was as much the bug as the
 * missing default was (spec-07 §"The web root").
 */
function webRoot(env: NodeJS.ProcessEnv, cwd: string, warn: Warn): string | null {
  const fromEnv = envValue(env, 'WEB_ROOT');
  if (fromEnv !== null) {
    return path.resolve(fromEnv);
  }

  const resolution = resolveWebRoot(cwd);
  warn(resolution.reason);
  return resolution.root;
}

/**
 * What came of looking for the built client with `WEB_ROOT` unset: the
 * directory to serve, and the line that explains the answer either way. The
 * reason is returned rather than logged where the walk happens, because the
 * walk is the one part of this worth testing on its own — and such a test must
 * never read this machine's own build output.
 */
export interface WebRootResolution {
  /** The built client's directory, or null when no client is being served. */
  root: string | null;
  /** One line for the operator: `serving the built client from …`, or why none. */
  reason: string;
}

/**
 * The built client, found by walking up from `startDir` to the directory whose
 * package manifest declares workspaces and taking `web/dist` under it.
 *
 * The walk is what lets an ordinary `npm start` serve the app: the server's
 * working directory is `server/`, a package but not the repository root, and
 * `WEB_ROOT` is a fact only a deployment knows to set. A package on the way up
 * is stepped over rather than stopped at, and a manifest that declares
 * workspaces but has no build under it ends the walk — that directory is the
 * answer, and a build belongs there, not further up.
 */
export function resolveWebRoot(startDir: string): WebRootResolution {
  const from = path.resolve(startDir);

  for (let dir = from; ; dir = path.dirname(dir)) {
    if (declaresWorkspaces(manifestAt(dir))) {
      return builtClientUnder(dir);
    }
    // The filesystem root's parent is itself: there is nothing above it to walk to.
    if (dir === path.dirname(dir)) {
      return {
        root: null,
        reason:
          `serving no client: no package manifest declaring workspaces above ${from}` +
          ' — the Vite dev loop serves the client, or set WEB_ROOT',
      };
    }
  }
}

/** A workspace root's resolution: the build under it, or why there is none (spec-07 §"The web root"). */
function builtClientUnder(workspaceRoot: string): WebRootResolution {
  const built = path.join(workspaceRoot, 'web', 'dist');
  if (isDirectory(built)) {
    return { root: built, reason: `serving the built client from ${built}` };
  }

  return {
    root: null,
    reason:
      `serving no client: ${workspaceRoot} declares workspaces but has no web/dist` +
      ' — run npm run build, or set WEB_ROOT',
  };
}

/**
 * A directory's `package.json`, parsed, or null when there is none or it cannot
 * be read. A manifest that will not parse is not a workspace root, and the walk
 * carries on past it, which is the most a stray file deserves.
 */
function manifestAt(dir: string): unknown {
  let contents: string;
  try {
    contents = readFileSync(path.join(dir, 'package.json'), 'utf8');
  } catch {
    return null;
  }

  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

/**
 * Whether a `package.json` declares workspaces — the marker that says this
 * directory is the repository root rather than a package inside it. npm takes
 * either an array or a `{ packages: […] }` object, so both count.
 */
function declaresWorkspaces(manifest: unknown): boolean {
  if (typeof manifest !== 'object' || manifest === null) return false;

  const workspaces = (manifest as Record<string, unknown>)['workspaces'];
  if (Array.isArray(workspaces)) return workspaces.length > 0;
  if (typeof workspaces !== 'object' || workspaces === null) return false;

  const packages = (workspaces as Record<string, unknown>)['packages'];
  return Array.isArray(packages) && packages.length > 0;
}

/** A path that is a directory. A *file* named `web/dist` is not a built client. */
function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function projectsRoot(env: NodeJS.ProcessEnv, configPath: string, warn: Warn): string | null {
  const fromEnv = envValue(env, 'PROJECTS_ROOT');
  if (fromEnv !== null) {
    return path.resolve(fromEnv);
  }

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
