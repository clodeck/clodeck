/**
 * The shell and environment the real spawner starts a pty with (spec-03 §"The
 * pty facade").
 *
 * Kept apart from the module that imports node-pty so these decisions can be
 * tested without importing a native binding or forking anything: the inputs are
 * passed in (`platform`, `$SHELL`, the parent environment) rather than read from
 * the live process, which is also what makes them decidable at all.
 */

/**
 * Windows dev gets PowerShell (the pty there runs under ConPTY); the Linux/Docker
 * deploy gets the login shell, or `bash` when there is nothing to inherit.
 */
export function platformShell(platform: NodeJS.Platform, shellFromEnv: string | undefined): string {
  if (platform === 'win32') return 'powershell.exe';
  return shellFromEnv !== undefined && shellFromEnv !== '' ? shellFromEnv : 'bash';
}

/**
 * The parent environment plus the two variables that make the shell advertise a
 * colour terminal — which is what xterm.js needs to render colour and cursor
 * control correctly. Unset vars are dropped: node-pty's `env` is a
 * `Record<string, string>` and a `undefined` value would not survive the native
 * boundary anyway.
 */
export function terminalEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) env[key] = value;
  }
  env['TERM'] = 'xterm-256color';
  env['COLORTERM'] = 'truecolor';
  return env;
}
