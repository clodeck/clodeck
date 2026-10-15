import proxyaddr from '@fastify/proxy-addr';

import { warnToConsole, type Warn } from './logging.js';

/**
 * The declared trust list — `CLODECK_TRUSTED_PROXIES` — checked, normalized, and
 * handed to `Fastify({ trustProxy })`.
 *
 * Without it a request carries no evidence of the browser behind a proxy: every
 * login from behind Caddy arrives from Caddy's own address, so five failures —
 * anyone's — lock the single legitimate user out for the lock window. With it,
 * `request.ip` is the address the *declared* proxy reports, which is the address
 * the login limiter keys on (ticket 65).
 *
 * The header is believed only as far as the list reaches. From a peer outside
 * it, `X-Forwarded-For` is ignored and the key stays the peer's own address, so
 * a client cannot lock out an address it does not own; and a forged prefix
 * *ahead* of the trusted hop changes nothing, because the key is the last hop
 * that hop itself added. A forged header from a peer *inside* the list can
 * rotate the bucket — the accepted cost, and the reason the list is declared
 * rather than guessed (`trustProxy: true`, or trusting every private range).
 *
 * The value is a comma-separated list of addresses, CIDR ranges, and the
 * keywords `loopback`, `linklocal` and `uniquelocal`, read exactly as
 * `proxy-addr` reads it. Whitespace around an entry is ignored, so a list typed
 * into a compose file with a space after each comma works. Unset — `null` — is
 * "trust nothing", which is the behaviour every deployment had before this
 * variable existed: the direct and tunnelled routes keep the bucket they have.
 *
 * A list that does not compile is **not** a boot failure. It is reported and
 * read as "trust nothing", the posture the session cookie's flag takes for an
 * origin it cannot use: the operator keeps a server, minus the behaviour they
 * were asking for, plus the line saying so. Compiling it here — with the same
 * library Fastify compiles it with — is what makes that promise keepable, since
 * Fastify throws on an unusable value while it is building the server.
 */
export function trustedProxyList(
  declared: string | null,
  warn: Warn = warnToConsole,
): string | null {
  if (declared === null) return null;

  const entries = declared.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry === '')) {
    warn(`ignoring CLODECK_TRUSTED_PROXIES "${declared}": it has an empty entry; no proxy is trusted`);
    return null;
  }

  try {
    // The split above is Fastify's own — it compiles exactly this array.
    proxyaddr.compile(entries);
  } catch (error) {
    warn(
      `ignoring CLODECK_TRUSTED_PROXIES "${declared}": ${String(error)}; no proxy is trusted, so a ` +
        "login behind one is counted against the proxy's address",
    );
    return null;
  }

  return entries.join(',');
}
