import { defineConfig } from '@playwright/test';

import { directOrigin } from './e2e/direct-origin';

/**
 * The end-to-end layer: the real app, in a real browser, asserting on the DOM.
 *
 * It is not part of `npm test` and deliberately so — it needs the app up, a
 * browser, and (for the direct-route project) a provider credential, none of
 * which the Vitest suite has. Run it with `npm run e2e` from the repo root.
 *
 * **Two projects, because there are two ways to reach the app.** `dev-pair` is
 * the five specs that drive the Vite dev server, exactly as before. `direct-route`
 * is the acceptance spec for the deployment with no domain, and it runs against
 * the *built client served by the server* at this machine's own LAN address —
 * the two are different origins with different prerequisites, so they are two
 * configurations rather than one base URL that changes underneath the specs.
 *
 * Either project on its own is `npm run e2e -- --project=dev-pair` (or
 * `--project=direct-route`), which is what a run that has only one of the two
 * apps up wants: the direct route is not skipped for being *down*, only for the
 * address not existing, because a spec that quietly stood aside whenever the
 * server was missing would never catch the bug it is here for.
 *
 * `channel: 'chrome'` is load-bearing, not a preference. `npx playwright install
 * chromium` fails on this network ("Failed to download Chrome for Testing"), so
 * the harness drives the browser already installed on the machine instead. Do
 * not "restore" the default download: it does not resolve here, and the failure
 * is at install time, far away from this file.
 *
 * The specs log in with `UI_PASSWORD` from the environment, which the server
 * under test must have been started with.
 */

/** The one spec that drives the direct route rather than the dev pair. */
const DIRECT_SPEC = '**/direct-route.spec.ts';

/** Resolved once, here and in the spec, by the same function. Null → that project skips. */
const directBaseURL = directOrigin();

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // The suite drives one shared app against one shared server; parallel workers
  // would each open a shell on the same project.
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'dev-pair',
      testIgnore: DIRECT_SPEC,
      // The Vite dev server, with the backend proxied behind it.
      use: { baseURL: 'http://localhost:5173' },
    },
    {
      name: 'direct-route',
      testMatch: DIRECT_SPEC,
      // This is the origin the project exists for: a browser at a LAN address has
      // no reason to keep a `Secure` cookie and throws it away, where loopback
      // keeps one for anybody. The longer timeout is the chat step's, which sends
      // a real turn.
      timeout: 180_000,
      use: directBaseURL === null ? {} : { baseURL: directBaseURL },
    },
  ],
});
