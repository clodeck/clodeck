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

/**
 * Where a line about something that *happened* is reported, as opposed to
 * {@link Warn}'s misconfiguration the server carried on from: which provider a
 * turn actually ran on, so "what was that turn running on" is answerable after
 * the fact (spec-08 §"Testing" — the run's own record, not an error).
 *
 * A second type rather than a second use of the first, because the two are read
 * for different reasons: an operator scanning warnings should not have to step
 * over one line per turn, and a later filter over runs should not have to know
 * which warnings exist.
 */
export type Log = (message: string) => void;

/** The default sink, for the same reason {@link warnToConsole} is. */
export const logToConsole: Log = (message) => {
  console.log(message);
};
