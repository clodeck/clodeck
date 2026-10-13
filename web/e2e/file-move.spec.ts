import { expect, test, type Page } from '@playwright/test';
import { login, removeRow } from './support';

/**
 * A drop point in the tree's own listing area that is over no row — the empty
 * space below the last one, which is where a user aims when they mean "out to
 * the root" (ticket 48). Returned relative to the area's box, which is what
 * `dragTo`'s `targetPosition` wants. Walks up from the bottom edge, because how
 * much blank space a project leaves depends on how many rows it has.
 */
async function rootDropPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByRole('group', { name: 'Files tree' }).boundingBox();
  if (box === null) throw new Error('the tree listing area has no box');
  const x = Math.round(box.width / 2);
  for (let y = Math.round(box.height) - 3; y > 0; y -= 3) {
    const blank = await page.evaluate(
      (point) => {
        const under = document.elementFromPoint(point.left, point.top);
        return under !== null && under.closest('li') === null;
      },
      { left: box.x + x, top: box.y + y },
    );
    if (blank) return { x, y };
  }
  throw new Error('this tree has no empty space left to drop on');
}

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

const FILE = 'zz-e2e-move.txt';
const FOLDER = 'zz-e2e-movedir';
const LONG_LINE = `// ${'a'.repeat(400)}`;

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
  // names the path its bytes now live at. `exact` because a file row's tooltip is
  // `Preview <name>` — a substring match would find the row as well as the head.
  await expect(page.getByTitle(`${FOLDER}/${FILE}`, { exact: true })).toBeVisible();

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
  await expect(page.getByTitle(FILE, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: FILE, exact: true })).toHaveCount(1);

  // And out once more, the way a user actually aims: a drop on the tree's own
  // body — the empty space below the rows — means the root too (ticket 48). The
  // crumb is still there; it is no longer the only way home.
  await page
    .getByRole('button', { name: FILE, exact: true })
    .dragTo(page.getByRole('button', { name: `${FOLDER}/` }));
  await page.getByRole('dialog', { name: 'Confirm move' }).getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('status')).toHaveText(`moved ${FILE} → ${FOLDER}`);

  const area = page.getByRole('group', { name: 'Files tree' });
  await page.getByRole('button', { name: FILE, exact: true }).dragTo(area, { targetPosition: await rootDropPoint(page) });
  const home = page.getByRole('dialog', { name: 'Confirm move' });
  await expect(home).toBeVisible();
  await expect(home).toContainText(`Move "${FILE}" into "root"?`);
  await home.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('status')).toHaveText(`moved ${FILE} → root`);
  await expect(page.getByTitle(FILE, { exact: true })).toBeVisible();

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
