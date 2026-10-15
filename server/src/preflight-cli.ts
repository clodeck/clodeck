import { loadConfig } from './config.js';
import { preflightProblems } from './preflight.js';

/**
 * `npm run serve`'s first step: read the config the server is about to read,
 * report what it says, and stop with a non-zero exit when it is not servable.
 *
 * It runs from source through `tsx` rather than from `dist` because it is
 * deliberately *before* the build — a missing password should stop the command
 * in a second, not two minutes of `tsc` and Vite later. It runs in the server
 * package's directory, the same one `npm start --workspace @clodeck/server`
 * runs in, so `clodeck.config.json` and the working directory resolve exactly
 * as they will for the server this command goes on to start.
 *
 * Unlike the server, this is allowed to stop: a deployment command that
 * publishes a login screen refusing every value is worse than one that says why
 * it will not start. No flag skips the check — see `preflight.ts`.
 */
const config = loadConfig();
const problems = preflightProblems(config);

if (problems.length > 0) {
  console.error('clodeck: the configuration is not servable — nothing was built:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('clodeck: preflight ok');
  // Which client directory is being served, read from the same field the server
  // starts from, so this log and the server's own line cannot disagree about it.
  // Unset is not a problem here: the built client is resolved at startup and
  // logged either way (spec-07 §"The web root"), and the dev loop resolves none
  // on purpose.
  console.log(
    config.webRoot === null
      ? 'clodeck: no client directory is declared — the server logs the one it resolves at startup'
      : `clodeck: serving the client from ${config.webRoot}`,
  );
}
