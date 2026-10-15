import { expect, test } from '@playwright/test';

import { directOrigin } from './direct-origin';
import { removeRow, signIn } from './support';

/**
 * The direct route, end to end, in a real browser — the acceptance test for the
 * deployment that has no domain (spec-07 §"Verification").
 *
 * It walks the whole slice: log in, send a turn and watch it answer, open the
 * terminal and see a shell, open the file drawer and see the tree — against the
 * **built client served by the server**, at **a non-loopback origin**.
 *
 * ## The origin is the point, not the browser
 *
 * Loopback is exempt from the `Secure` cookie rule, so a browser at
 * `http://localhost` keeps a `Secure` cookie happily — which is why every other
 * spec in this layer passes *with the bug present*, and why this one cannot be
 * "simplified" back to localhost. **Do not.** At a LAN address the browser
 * discards a `Secure` cookie instead: the login answers 200, the session is
 * thrown away, `/api/auth/me` answers 401, and the app bounces back to the
 * sign-in screen. That is the assertion below the login, and it is the whole
 * reason this file exists. A spec that pins the origin to localhost asserts
 * nothing about it — it passes either way.
 *
 * The address is this machine's own, resolved at run time (`direct-origin.ts`),
 * and a machine with no non-loopback IPv4 skips rather than pretends.
 *
 * ## What puts the app up
 *
 * Not this spec, exactly as the dev-pair specs do not start Vite. The app has
 * to be up on the direct route first — the built client, the declared public
 * origin, and the bind that makes it reachable:
 *
 *     npm run build
 *     HOST=0.0.0.0 CLODECK_PUBLIC_URL=http://<this machine's LAN address>:3001 \
 *       UI_PASSWORD=… PROJECTS_ROOT=… npm run serve
 *
 * `CLODECK_PUBLIC_URL` and `HOST` are prerequisites of the *route*, not of this
 * file: without the bind nothing is listening at the LAN address, and without
 * the declared origin the cookie stays `Secure` — which is the failure this
 * spec is here to catch, not one to skip past. `PORT`, when set, moves both this
 * spec and the server (both read it, and both default to 3001). The chat step
 * sends one real turn, so the server needs a working provider credential — a
 * deployment has one, and this is the deployment's own path.
 *
 * It writes one file into the project it drives, and deletes it again.
 */

/** Asked of the provider, and unmistakable in the transcript. */
const PROMPT = 'Reply with exactly: the direct route is live.';

/** Typed at the shell, then read back off the screen twice — see the terminal step. */
const ECHO = 'zz-direct-route-ok';

/** Uploaded through the drawer and removed again, so the project is left as found. */
const FILE = 'zz-e2e-direct.txt';

test('login, chat, shell and file drawer hold at this machine\'s LAN origin', async ({ page }) => {
  const origin = directOrigin();
  test.skip(origin === null, 'this machine has no non-loopback IPv4 address to drive the direct route from');

  // The login is the assertion the bug breaks, and it is asserted here before
  // anything else the app draws. With the cookie still `Secure`, a browser at a
  // bare LAN origin discards what the login just handed it: the request below
  // carries no session and answers 401, and the app bounces back to the sign-in
  // screen — which is why the workspace wait under it would never return. The
  // poll is for the login's own round trip, not for the assertion's sake: until
  // it lands there is no cookie to present.
  await signIn(page);
  await expect.poll(async () => (await page.request.get('/api/auth/me')).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'demo', exact: true }).click();

  // Chat: one turn, sent at this origin and followed to its end. The composer
  // is enabled only once the chat socket is live, so this is also the websocket
  // handshake — which the same-origin check admits at any host.
  const message = page.getByRole('textbox', { name: 'Message' });
  const transcript = page.locator('section[aria-label="Chat"] ol');
  await expect(message).toBeEnabled();
  await message.fill(PROMPT);
  await message.press('Enter');
  await expect(transcript).toContainText(PROMPT);

  // The list holds settled entries only; the text that streams is its sibling,
  // so a second row is the provider's own output arriving over the socket — and
  // the result line is the turn's far end, which only a `result` produces.
  await expect.poll(async () => transcript.locator('li').count()).toBeGreaterThan(1);
  await expect(page.getByText(/Turn complete/)).toBeVisible();

  // Terminal: a shell, not an empty frame. xterm echoes nothing itself — every
  // character on that screen came back from the pty over `/ws/terminal` — so the
  // typed line appearing *twice* (once as the command the shell echoed, once as
  // the output it printed) is a shell answering, not a painted box.
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.xterm')).toHaveCount(1);
  await page.locator('.xterm').click();
  await page.keyboard.type(`echo ${ECHO}\n`);
  await expect(page.locator('.xterm-rows')).toContainText(new RegExp(`${ECHO}[\\s\\S]*${ECHO}`));

  // The file drawer: the tree this server answers with, at this origin. The
  // upload is here for the assertion it gives the tree — a row that can only be
  // there because the file routes answered — and it is removed again below.
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Files tree' })).toBeVisible();
  await page.setInputFiles('input[aria-label="Choose files to upload"]', {
    name: FILE,
    mimeType: 'text/plain',
    buffer: Buffer.from('the direct route\n'),
  });
  await expect(page.getByRole('button', { name: FILE, exact: true })).toBeVisible();

  await removeRow(page, FILE);
});
