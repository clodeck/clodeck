import { defineConfig } from '@playwright/test';

/**
 * Throwaway debug harness for bug #1 (terminal accumulates on project switch) —
 * see `.scratch/clodeck/handoff.md`. Uses the machine's installed Chrome via
 * `channel`, because the Playwright Chromium download fails on this network.
 *
 * Assumes the dev loop is already up (`PORT=3300 npm run dev`).
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
  },
});
