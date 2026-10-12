import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { login, removeRow } from './support';

/**
 * Downloading a file, in a real browser.
 *
 * This spec exists because jsdom stops at the link: it has no downloads, so
 * clicking the anchor there is a `Not implemented: navigation` line rather than a
 * save, and the rendered tests can assert the `href` and nothing past it. Only a
 * browser can say whether the bytes really arrive — and under which name, which
 * is the interesting half. The name comes from the response's
 * `Content-Disposition`, the one place a non-ASCII file name can be lost, so the
 * file this spec downloads is named in Persian and must come back as itself.
 *
 * Like the upload spec it writes into the project it drives, and deletes what it
 * created through the row menu before it ends.
 */

const NAME = 'zz-e2e-دانلود.txt';
const BODY = 'the bytes, as written';

test('a file downloads under its own name, with the bytes the server holds', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();

  // Give the spec a file whose bytes it knows.
  await page.setInputFiles('input[aria-label="Choose files to upload"]', {
    name: NAME,
    mimeType: 'text/plain',
    buffer: Buffer.from(BODY),
  });
  await expect(page.getByRole('status')).toHaveText(`uploaded ${NAME}`);

  await page.getByRole('button', { name: NAME, exact: true }).click();
  await expect(page.getByText(BODY)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download' }).click(),
  ]);

  // The name the browser saves it under is the disposition the server sent,
  // read by the browser itself: this is what `filename*=UTF-8''…` buys.
  expect(download.suggestedFilename()).toBe(NAME);
  const saved = await download.path();
  if (saved === null) throw new Error('the download produced no file');
  expect(await readFile(saved, 'utf8')).toBe(BODY);

  await removeRow(page, NAME);
});
