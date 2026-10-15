/**
 * Where a line for the operator is reported: a recoverable misconfiguration, or
 * the resolution that stands in its place — an unset `WEB_ROOT` that resolved to
 * a build, say, which is worth a line precisely because it is invisible
 * otherwise (spec-07 §"The web root").
 */
export type Warn = (message: string) => void;

/**
 * The default sink. Deliberately the console: this slice has no logging
 * subsystem yet, and every message that goes through here describes something
 * the server carried on from.
 */
export const warnToConsole: Warn = (message) => {
  console.warn(message);
};
