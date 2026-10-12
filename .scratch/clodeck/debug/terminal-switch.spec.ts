import { expect, test, type Page } from '@playwright/test';

/**
 * Bug #1 feedback loop: does switching projects accumulate `.xterm` nodes?
 *
 * The complaint (handoff, verbatim): selecting a project opens a terminal on the
 * right; switching to another project leaves the previous terminal on screen and
 * opens a new one *below* it, and this keeps growing. Expected: the new terminal
 * replaces the old one.
 *
 * Two jsdom rendered tests already cover the React lifecycle and stay green, so
 * this loop drives the *real* app in a *real* browser instead. It asserts the
 * user's exact symptom: exactly one `.xterm` on screen after each switch.
 *
 * The password comes from `UI_PASSWORD` in the environment, never a literal —
 * the server is hashed against the same value, and a wrong guess here burns one
 * of the five login attempts before the address is locked for 15 minutes.
 */

const password = process.env['UI_PASSWORD'];
if (!password) throw new Error('UI_PASSWORD must be set (the dev loop uses `dev`)');

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#password', password);
  await page.press('#password', 'Enter');
  await expect(page.getByRole('button', { name: 'demo' })).toBeVisible();
}

async function selectProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

/** The symptom's observable: how many terminals the DOM is holding. */
async function xtermCount(page: Page): Promise<number> {
  return page.locator('.xterm').count();
}

test('switching projects leaves exactly one terminal on screen', async ({ page }) => {
  await login(page);

  await selectProject(page, 'demo');
  await expect(page.locator('.xterm')).toHaveCount(1);
  console.log('[debug] after selecting demo:', await xtermCount(page));

  // Back and forth, because the complaint was accumulation: "this keeps growing".
  // One switch proves the key collision; three prove nothing leaks per switch.
  for (const name of ['hello', 'demo', 'hello']) {
    await selectProject(page, name);
    await page.waitForTimeout(1000);
    console.log(`[debug] after switching to ${name}:`, await xtermCount(page));
    // The assertion the bug fails: one terminal, not two.
    await expect(page.locator('.xterm')).toHaveCount(1);
  }

  await expect(page.locator('section[aria-label="Terminal"]')).toHaveCount(1);
  await expect(page.locator('section[aria-label="Files"]')).toHaveCount(1);
  await page.screenshot({ path: '.scratch/clodeck/debug/after-fix.png' });
});
