import { expect, test } from '@playwright/test';
import { login } from './support';

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
 * one terminal, however many times you switch. Since ticket 35 the terminal is
 * in the bottom drawer, so the spec summons it from the rail first — and the
 * rail's choice is workspace state, which is why the drawer stays on Terminal
 * across every switch below.
 */

test('switching projects replaces the terminal rather than accumulating one', async ({ page }) => {
  await login(page);

  await page.getByRole('button', { name: 'demo', exact: true }).click();

  // The drawer is shut on first load: no shell is spawned until it is summoned.
  await expect(page.locator('.xterm')).toHaveCount(0);

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.xterm')).toHaveCount(1);

  // Back and forth, because the complaint was accumulation — "this keeps
  // growing". One switch proves the collision; three prove nothing leaks.
  for (const name of ['hello', 'demo', 'hello']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.xterm')).toHaveCount(1);
  }

  // Exactly one of the panels behind it, and the tab survived every switch.
  await expect(page.locator('section[aria-label="Terminal"]')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');

  // The other tab is the same drawer's sibling: switching to it unmounts the
  // shell rather than leaving a zero-height xterm behind.
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toHaveCount(1);
  await expect(page.locator('.xterm')).toHaveCount(0);
});
