import { expect, test, type Page } from '@playwright/test';

/**
 * Uploading through the file drawer, in a real browser.
 *
 * This spec exists because drag-and-drop is the one thing the rendered tests
 * cannot see: jsdom has no `DragEvent`, so `fireEvent.dragOver` hands the
 * handler a plain `Event` with a `dataTransfer` bolted on, and the overlay's
 * `pointer-events-none` (what lets a drag pass through it to the panel beneath)
 * is never exercised. Here the events are the browser's own, built from a real
 * `DataTransfer`.
 *
 * It writes into the project it drives, so it also cleans up after itself: every
 * file it uploads is deleted through the row menu before the spec ends.
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

const KEPT = 'zz-e2e-upload.txt';
const ALSO = 'zz-e2e-upload-two.txt';
const OVERLAY = 'Drop files to upload · max 200 MB';

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#password', password);
  await page.press('#password', 'Enter');
  await expect(page.getByRole('button', { name: 'demo' })).toBeVisible();
}

/**
 * One drag over the file panel, carrying `files` as OS files — or, when `files`
 * is empty and `plain` is true, carrying text instead (what a tree row dragged
 * for a move looks like).
 */
async function drag(page: Page, kind: 'dragover' | 'dragleave' | 'drop', files: string[]): Promise<void> {
  await page.evaluate(
    ({ type, names }) => {
      const panel = document.querySelector('section[aria-label="Files"]');
      if (panel === null) throw new Error('no Files panel');
      const transfer = new DataTransfer();
      if (names.length === 0) transfer.setData('text/plain', 'src/row.txt');
      for (const name of names) transfer.items.add(new File(['hello'], name, { type: 'text/plain' }));
      panel.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    },
    { type: kind, names: files },
  );
}

/** Delete one uploaded file through its row menu, so the project is left as found. */
async function removeRow(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
}

test('the drawer shows the drop target and reports a batch once', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();

  // A drag that is not carrying OS files shows nothing — 44's row move is one.
  await drag(page, 'dragover', []);
  await expect(page.getByText(OVERLAY)).toHaveCount(0);

  // An OS-file drag shows the target and the cap, and leaving takes it away.
  await drag(page, 'dragover', [KEPT]);
  await expect(page.getByText(OVERLAY)).toBeVisible();
  await drag(page, 'dragleave', []);
  await expect(page.getByText(OVERLAY)).toHaveCount(0);

  // One file: named, with its size on the row it lands in.
  await drag(page, 'drop', [KEPT]);
  await expect(page.getByRole('status')).toHaveText(`uploaded ${KEPT}`);
  await expect(page.getByRole('button', { name: KEPT, exact: true }).locator('..')).toContainText('5 B');
  await expect(page.getByText(OVERLAY)).toHaveCount(0);

  // Two files where one is already there: both counts, and the reason under them.
  await drag(page, 'drop', [KEPT, ALSO]);
  const toast = page.getByRole('status');
  await expect(toast).toContainText('1 uploaded · 1 failed');
  await expect(toast).toContainText('409 Conflict: already exists');
  await expect(page.getByRole('button', { name: ALSO, exact: true })).toBeVisible();

  await removeRow(page, KEPT);
  await removeRow(page, ALSO);
});
