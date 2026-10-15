import { warnToConsole, type Warn } from '../logging.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSessionStore } from './sessions.js';
import type { AuthOptions } from './transport.js';

/**
 * The production `auth` seam, built from configuration (spec-05 §"Config + main
 * wiring").
 *
 * Failure to configure a password is **fail-closed**, never open: the server
 * boots, the gate is installed like always, and `verifyPassword` refuses every
 * value — so every `/api/**` route and every socket answers 401 and no login
 * can succeed. That is the same posture as an unconfigured projects root
 * ("empty list, logged"), applied to a credential.
 *
 * The declared public origin rides along untouched: this builder is the one hop
 * between configuration and the browser's cookie rule (spec-07 §"The public
 * origin"), and it decides nothing about it — the transport does, and warns
 * there if the value is not an origin.
 *
 * It lives here rather than in `main.ts` so both entry points that boot a real
 * server (`main.ts`, `testing/dev-fake.ts`) share one decision, and so the
 * decision is testable without a listening process.
 */
export async function createAuthOptions(
  uiPassword: string | null,
  publicOrigin: string | null = null,
  warn: Warn = warnToConsole,
): Promise<AuthOptions> {
  const sessions = createSessionStore();

  if (uiPassword === null) {
    warn(
      'UI_PASSWORD is not set: every /api route and both websockets will answer 401 ' +
        '(fail-closed). Set UI_PASSWORD or UI_PASSWORD_FILE to log in.',
    );
    return { sessions, verifyPassword: () => Promise.resolve(false), publicOrigin };
  }

  // Hashed once, at boot: the plaintext is not kept, and every login attempt
  // compares against the hash.
  const hash = await hashPassword(uiPassword);
  return { sessions, verifyPassword: (password) => verifyPassword(password, hash), publicOrigin };
}
