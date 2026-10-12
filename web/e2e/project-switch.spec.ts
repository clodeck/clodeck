import { expect, test, type Page } from '@playwright/test';

/**
 * Switching projects in the workspace, in a real browser.
 *
 * This spec exists because of a bug no unit test could see (ticket 31): the
 * panel grid keyed `TerminalPanel` and `FilePanel` with the same project id, so
 * React's key map kept one entry per key, the first sibling fell out of its
 * bookkeeping, and the old terminal was never unmounted — it stayed on screen
 * while a new one was appended below it, growing on every switch. The rendered
 * test that "covered" the remount rendered the panel *alone*, where a collision
 * with a sibling is structurally invisible.
 *
 * So the assertion here is the user's own symptom, counted in the DOM: exactly
 * one terminal, however many times you switch.
 */

/** A required environment variable, or the suite stops before it drives anything. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set — the server under test reads the same value`);
  }
  return value;
}

const password = requireEnv('UI_PASSWORD');

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#password', password);
  await page.press('#password', 'Enter');
  await expect(page.getByRole('button', { name: 'demo' })).toBeVisible();
}

test('switching projects replaces the terminal rather than accumulating one', async ({ page }) => {
  await login(page);

  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await expect(page.locator('.xterm')).toHaveCount(1);

  // Back and forth, because the complaint was accumulation — "this keeps
  // growing". One switch proves the collision; three prove nothing leaks.
  for (const name of ['hello', 'demo', 'hello']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.xterm')).toHaveCount(1);
  }

  // The panels around it stayed pin-sharp too: one of each, still on screen.
  await expect(page.locator('section[aria-label="Terminal"]')).toHaveCount(1);
  await expect(page.locator('section[aria-label="Files"]')).toHaveCount(1);
});
