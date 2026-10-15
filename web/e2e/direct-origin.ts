import { networkInterfaces } from 'node:os';

/**
 * The origin the **direct route** is reached at — this machine's own LAN
 * address, resolved when the run starts (spec-07 §"Verification").
 *
 * The address is the point, not the browser. Loopback is exempt from the
 * `Secure` cookie rule, so a spec that drives `http://localhost` passes *with
 * the bug present*; the origin has to be one a browser refuses a `Secure`
 * cookie on. Nothing here can be written down either, because which interface
 * carries the address differs per machine — hence the read at run time, and
 * `null` on a machine that has no non-loopback IPv4 at all, which the direct
 * spec turns into a skip rather than a lie.
 *
 * The two readers — `playwright.config.ts`, which sets the project's `baseURL`,
 * and the spec, which decides the skip — call this same function, so the origin
 * they are talking about cannot drift.
 *
 * The port is `PORT`, the variable the server under test reads and defaults to
 * 3001 (`server/src/main.ts`), so `PORT=3300 npm run e2e` and the `npm run
 * serve` it is pointed at agree about where the app is.
 */
export function directOrigin(): string | null {
  const address = lanAddress();
  return address === null ? null : `http://${address}:${port()}`;
}

/**
 * The first non-loopback IPv4 address this machine has, or null. Interfaces
 * come back in the order the OS lists them, so this is whichever one it reaches
 * first — the address the operator would also see in `ifconfig`. A machine
 * reachable only over loopback (a bare container, a laptop with its network
 * down) has none, and that is a skip: there is nothing to drive.
 */
function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

function port(): string {
  const fromEnv = process.env['PORT']?.trim();
  return fromEnv === undefined || fromEnv === '' ? '3001' : fromEnv;
}
