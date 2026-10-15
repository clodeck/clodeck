import { expect, type Page } from '@playwright/test';

/**
 * What every browser spec starts from: the environment the server under test
 * reads, the login that gets past its gate, and the row cleanup the specs that
 * write into a project share.
 *
 * They live here rather than in each spec because they are otherwise the same
 * several lines copied five times — and a change to the login (a different
 * selector, one more thing to wait for) should not have to be made five times
 * over to be true.
 */

/** A required environment variable, or the suite stops before it drives anything. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set — the server under test reads the same value`);
  }
  return value;
}

/** The password the server under test was started with (`UI_PASSWORD`). */
export const password: string = requireEnv('UI_PASSWORD');

/** Log in through the app's own door, and wait for the workspace behind it. */
export async function login(page: Page): Promise<void> {
  await signIn(page);
  await expect(page.getByRole('button', { name: 'demo' })).toBeVisible();
}

/**
 * The login round trip on its own — the box filled, Enter pressed — without the
 * wait for the workspace that follows it.
 *
 * Split out for the one spec whose *point* is that the session survives the
 * round trip rather than what the app draws afterwards (`direct-route.spec.ts`):
 * asserting the session before the workspace appears is what makes a red run
 * read as "401" instead of as a project button that never came.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#password', password);
  await page.press('#password', 'Enter');
}

/**
 * Delete one entry through its row menu, so a spec leaves the project as it
 * found it. The row's *menu* is what is asserted gone, not its name: a folder's
 * button carries its caret in its accessible name, so `Actions for x` is the one
 * handle both kinds of row have.
 */
export async function removeRow(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: `Actions for ${name}` })).toHaveCount(0);
}
