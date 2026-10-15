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
 * The hosts a browser treats as a secure context, and the reason a loopback
 * origin is silent here: `localhost`, `127.0.0.1` and `[::1]` are secure
 * contexts, which is why a `Secure` session cookie works there at all (see
 * `auth/transport.ts`) and why an SSH tunnel reaches the app through one without
 * weakening anything. Bracketed exactly as `URL.hostname` spells an IPv6
 * literal, so the lookup needs no unwrapping.
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
