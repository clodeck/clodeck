import { defineConfig } from '@playwright/test';

/**
 * The end-to-end layer: the real app, in a real browser, asserting on the DOM.
 *
 * It is not part of `npm test` and deliberately so — it needs the dev loop up
 * (`PORT=3300 npm run dev`) and a browser, which the Vitest suite does not. Run
 * it with `npm run e2e` from the repo root.
 *
 * `channel: 'chrome'` is load-bearing, not a preference. `npx playwright install
 * chromium` fails on this network ("Failed to download Chrome for Testing"), so
 * the harness drives the browser already installed on the machine instead. Do
 * not "restore" the default download: it does not resolve here, and the failure
 * is at install time, far away from this file.
 *
 * `baseURL` is the Vite dev server. The spec logs in with `UI_PASSWORD` from the
 * environment, which the server under test must be hashed against.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // The suite drives one shared app against one shared server; parallel workers
  // would each open a shell on the same project.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
  },
});
