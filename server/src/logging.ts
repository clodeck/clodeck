/** Where a recoverable misconfiguration is reported to a human. */
export type Warn = (message: string) => void;

/**
 * The default sink. Deliberately the console: this slice has no logging
 * subsystem yet, and every message that goes through here describes something
 * the server carried on from.
 */
export const warnToConsole: Warn = (message) => {
  console.warn(message);
};
