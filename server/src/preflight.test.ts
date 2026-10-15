import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import { preflightProblems } from './preflight.js';
import { createSandbox, removeSandbox, type Sandbox } from './test-support.js';

/**
 * The serve command's verdict on a config, driven through the loader.
 *
 * The three states each variable can be in — missing, blank, present — are
 * exactly the loader's three, and "blank is missing" is asserted here rather
 * than in `preflightProblems`, because that is where the rule lives: by the
 * time a config reaches the preflight, an exported-but-empty variable is
 * already `null`. The config file is the loader's other door, so a projects
 * root that arrives through it counts as present here too.
 */
describe('the serve preflight', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await createSandbox('clodeck-preflight-');
  });

  afterEach(async () => {
    await removeSandbox(sandbox);
  });

  /** The problems for one environment, as `npm run preflight` reads it. */
  function problemsFor(env: NodeJS.ProcessEnv, configPath = absentConfig()): string[] {
    return preflightProblems(loadConfig({ env, configPath, warn: () => undefined }));
  }

  /** A path with no config file behind it, so the environment is all there is. */
  function absentConfig(): string {
    return path.join(sandbox.dir, 'absent.config.json');
  }

  it('stops on a missing UI_PASSWORD', () => {
    const problems = problemsFor({ PROJECTS_ROOT: sandbox.root });

    expect(problems).toHaveLength(1);
    expect(problems.join('\n')).toContain('UI_PASSWORD');
  });

  it('stops on a missing PROJECTS_ROOT', () => {
    const problems = problemsFor({ UI_PASSWORD: 'a-password' });

    expect(problems).toHaveLength(1);
    expect(problems.join('\n')).toContain('PROJECTS_ROOT');
  });

  it('reports both when neither is configured, so one run names every fix', () => {
    const problems = problemsFor({});

    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('UI_PASSWORD');
    expect(problems.join('\n')).toContain('PROJECTS_ROOT');
  });

  it('counts a blank UI_PASSWORD as missing, exactly as the loader does', () => {
    const problems = problemsFor({ UI_PASSWORD: '   ', PROJECTS_ROOT: sandbox.root });

    expect(problems).toHaveLength(1);
    expect(problems.join('\n')).toContain('UI_PASSWORD');
  });

  it('counts a blank PROJECTS_ROOT as missing, exactly as the loader does', () => {
    const problems = problemsFor({ UI_PASSWORD: 'a-password', PROJECTS_ROOT: ' ' });

    expect(problems).toHaveLength(1);
    expect(problems.join('\n')).toContain('PROJECTS_ROOT');
  });

  it('passes with a password and a projects root', () => {
    expect(problemsFor({ UI_PASSWORD: 'a-password', PROJECTS_ROOT: sandbox.root })).toEqual([]);
  });

  it('passes with the password in a file, the way the loader accepts one', async () => {
    const secret = path.join(sandbox.dir, 'password.txt');
    await writeFile(secret, 'a-password\n');

    expect(problemsFor({ UI_PASSWORD_FILE: secret, PROJECTS_ROOT: sandbox.root })).toEqual([]);
  });

  it('passes with the projects root in the config file, the loader\'s other door', async () => {
    const configPath = path.join(sandbox.dir, 'clodeck.config.json');
    await writeFile(configPath, JSON.stringify({ projectsRoot: sandbox.root }));

    expect(problemsFor({ UI_PASSWORD: 'a-password' }, configPath)).toEqual([]);
  });
});
