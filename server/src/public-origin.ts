/**
 * The declared public origin's one line that is not about the cookie
 * (spec-07 §"The warnings").
 *
 * A plain-HTTP origin on a non-loopback host is a *choice*, not a mistake — it
 * is what the direct route is for — but it costs the password, every chat
 * message and every byte of terminal output in cleartext, and the operator
 * should hear that from the server rather than from a README they may never
 * open. One line, once, at startup.
 */

/**
 * The loopback hosts this line excuses, matched whole — `localhost` and its two
 * IP spellings, not a name that merely contains one. Reached at one of these the
 * traffic stays on the machine, or is already inside an SSH tunnel, which is the
 * one route that hands the browser a loopback origin; either way there is no
 * cleartext hop to speak up about. Bracketed exactly as `URL.hostname` spells an
 * IPv6 literal, so the lookup needs no unwrapping.
 *
 * Deliberately narrower than the browser's own potentially-trustworthy set,
 * which also covers `127.0.0.0/8` and `*.localhost`: the spec names these three
 * (spec-07 §"The warnings"), and a local spelling outside them costs a warning
 * rather than silence — the direction a warning about cleartext should err in.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The line, or `null` when there is nothing worth saying. An `https:` origin, an
 * undeclared one, and a value that is not an origin at all are silent too: the
 * last of those is reported by the auth transport, which is where the cookie it
 * cannot decide is decided.
 */
export function cleartextOriginWarning(publicOrigin: string | null): string | null {
  if (publicOrigin === null) return null;

  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    return null;
  }

  if (origin.protocol !== 'http:') return null;
  if (LOOPBACK_HOSTS.has(origin.hostname)) return null;

  return (
    `CLODECK_PUBLIC_URL is ${publicOrigin}: plain HTTP on a non-loopback host, so the password, ` +
    'every chat message and every byte of terminal output cross the network in cleartext. ' +
    'Reach the app at an https: origin — a TLS-terminating proxy, or an SSH tunnel — to encrypt them.'
  );
}
