/**
 * Whether the origin this page was loaded from leaves the login password in the
 * clear (ticket 62).
 *
 * The rule is the browser's own — it is the browser that decides what a bare
 * origin means for the session cookie on the direct route (spec-07) — and the
 * client already knows the origin it was loaded from, so nothing here asks the
 * server. That is also why it is a *predicate*, kept apart from the screen that
 * renders the notice: the decision and its rendering are separately testable.
 *
 * Pure, and given the origin as a string, so the caller reads `location.origin`
 * and everything about the decision is a value.
 */

/**
 * The hosts a browser treats as loopback — the set spec-07 §"The warnings"
 * names, matched exactly: `localhost` and its IP spellings, not a name that
 * merely contains one. Nothing else is excused, because the notice is a claim
 * about an unencrypted network path, and only loopback is one that is not.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isCleartextOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // An origin we cannot read is not one we can call unencrypted: the notice
    // is a fact about a connection, not the default when one is unknown.
    return false;
  }

  // The host is read, never compared as text: `new URL` lower-cases it and
  // keeps an IPv6 address in its brackets, so the spelling the browser reports
  // is the spelling that is matched.
  return url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname);
}
