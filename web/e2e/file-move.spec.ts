import { expect, test, type Page } from '@playwright/test';

/**
 * Moving a file by dragging its row onto a folder, in a real browser.
 *
 * This spec exists because jsdom has no `DragEvent` at all: the rendered tests
 * dispatch a `MouseEvent` of the same type and stub `dataTransfer.setData`, so
 * "the row is draggable" and "the browser really hands the handler a transfer"
 * are exactly the two things they cannot say. Here the drag is the browser's own
 * — started from a row that had to carry `draggable` for it to start at all, and
 * dropped with the transfer the browser built.
 *
 * It writes into the project it drives, and cleans up after itself by deleting
 * the folder it made (which takes the moved file with it).
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

const FILE = 'zz-e2e-move.txt';
const FOLDER = 'zz-e2e-movedir';
const LONG_LINE = `// ${'a'.repeat(400)}`;

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#password', password);
  await page.press('#password', 'Enter');
  await expect(page.getByRole('button', { name: 'demo' })).toBeVisible();
}

test('a file row dragged onto a folder row moves the file, and follows it back', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();

  // A file to move and a folder to move it into, both made here.
  await page.setInputFiles('input[aria-label="Choose files to upload"]', {
    name: FILE,
    mimeType: 'text/plain',
    buffer: Buffer.from(`${LONG_LINE}\nsecond line\n`),
  });
  await expect(page.getByRole('status')).toHaveText(`uploaded ${FILE}`);

  await page.getByRole('button', { name: 'New Folder' }).click();
  await page.getByLabel('Name').fill(FOLDER);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('status')).toHaveText(`folder ${FOLDER} created`);

  // Open the file first, so the move has a selection to carry.
  await page.getByRole('button', { name: FILE, exact: true }).click();
  await expect(page.getByText('second line')).toBeVisible();

  // A folder row's name carries its caret, so it is matched by substring; the
  // file row's does not.
  await page
    .getByRole('button', { name: FILE, exact: true })
    .dragTo(page.getByRole('button', { name: `${FOLDER}/` }));

  // The browser's own drag opened the prototype's question...
  const dialog = page.getByRole('dialog', { name: 'Confirm move' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Move "${FILE}" into "${FOLDER}"?`);
  await dialog.getByRole('button', { name: 'Move' }).click();

  await expect(page.getByRole('status')).toHaveText(`moved ${FILE} → ${FOLDER}`);
  // The file arrived in the folder — which the move opened — and left the root:
  // one row of that name is on the page, and it is the folder's.
  await expect(page.getByRole('button', { name: FILE, exact: true })).toHaveCount(1);
  await expect(page.getByTitle('Collapse folder')).toBeVisible();
  // And the open file followed itself rather than going stale: the code head
  // names the path its bytes now live at.
  await expect(page.getByTitle(`${FOLDER}/${FILE}`)).toBeVisible();

  // Back out to the root, by dropping on the breadcrumb's root crumb — the drop
  // target the prototype did not have, and the only way home from the tree.
  await page
    .getByRole('button', { name: FILE, exact: true })
    .dragTo(page.getByRole('navigation', { name: 'Folder' }).getByText('root'));
  await expect(page.getByRole('dialog', { name: 'Confirm move' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Confirm move' })
    .getByRole('button', { name: 'Move' })
    .click();

  await expect(page.getByRole('status')).toHaveText(`moved ${FILE} → root`);
  // Home again: the head names the bare name once more, and one row carries it.
  await expect(page.getByTitle(FILE)).toBeVisible();
  await expect(page.getByRole('button', { name: FILE, exact: true })).toHaveCount(1);

  // Clean up: the file, then the folder it visited.
  for (const name of [FILE, FOLDER]) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Confirm delete' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByRole('button', { name: `Actions for ${name}` })).toHaveCount(0);
  }
});
