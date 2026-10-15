import type { ServerConfig } from './config.js';

/**
 * What `npm run serve` refuses to start for (spec-07 §"The serve script").
 *
 * Two misconfigurations are silent at runtime, and for a deployment command
 * that is the wrong shape: an unset `UI_PASSWORD` boots fail-closed, so the
 * operator stares at a login screen that refuses every value, and an unset
 * `PROJECTS_ROOT` is an empty project list behind a warning nobody reads. Both
 * are worth stopping for — before the build, not after it.
 *
 * A pure function of the loaded config, so the suite exercises the verdict and
 * the command only prints it. There is deliberately no acknowledgement flag:
 * the safe path stays the default and the risky one stays a single setting
 * (spec-07 §"The warnings").
 *
 * "Blank counts as missing" is the loader's rule, applied there: an
 * exported-but-empty variable is already `null` by the time a config arrives
 * here (`config.ts`), and this is the door every config comes through.
 */
export function preflightProblems(config: ServerConfig): string[] {
  const problems: string[] = [];

  if (config.uiPassword === null) {
    problems.push(
      'UI_PASSWORD is not set: the server would boot fail-closed and refuse every login. ' +
        'Set UI_PASSWORD, or UI_PASSWORD_FILE to a file holding it.',
    );
  }

  if (config.projectsRoot === null) {
    problems.push(
      'PROJECTS_ROOT is not set: the project list would be empty. ' +
        'Set PROJECTS_ROOT, or "projectsRoot" in clodeck.config.json.',
    );
  }

  return problems;
}
