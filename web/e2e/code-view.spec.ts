import { expect, test } from '@playwright/test';
import { login } from './support';

/**
 * The code view's layout, in a real browser.
 *
 * The rendered tests can count the gutter's rows and read the segments out of
 * the DOM; they cannot see a single thing about where the numbers *land*.
 * jsdom computes no layout and no stylesheet, so "the numbers line up in a
 * column", "a long line scrolls instead of wrapping" and "the token is actually
 * the palette's colour" are unanswerable there — and they are the whole of what
 * this view is for. So this spec asks the browser for boxes and computed styles.
 *
 * It writes into the project it drives, and deletes what it made before it ends.
 */

const NAME = 'zz-e2e-code.ts';
/** A keyword, a number and a comment, then a line long enough to overflow the column. */
const BODY = `const x = 42; // ${'a'.repeat(400)}\nsecond line\n`;

test('the code view numbers its lines, keeps them from wrapping, and colours them', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();

  await page.setInputFiles('input[aria-label="Choose files to upload"]', {
    name: NAME,
    mimeType: 'text/plain',
    buffer: Buffer.from(BODY),
  });
  await expect(page.getByRole('status')).toHaveText(`uploaded ${NAME}`);

  await page.getByRole('button', { name: NAME, exact: true }).click();
  const source = page.getByRole('list', { name: 'Source' });
  await expect(source).toBeVisible();

  const layout = await source.evaluate((list) => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
    const cells = rows.map((row) => {
      const gutter = row.children[0] as HTMLElement;
      const line = row.children[1] as HTMLElement;
      return {
        number: gutter.textContent,
        gutterRight: Math.round(gutter.getBoundingClientRect().right),
        lineLeft: Math.round(line.getBoundingClientRect().left),
        rowHeight: Math.round(row.getBoundingClientRect().height),
        selectable: getComputedStyle(gutter).userSelect,
      };
    });
    const scroller = list.parentElement;
    return {
      cells,
      scrollWidth: scroller?.scrollWidth ?? 0,
      clientWidth: scroller?.clientWidth ?? 0,
    };
  });

  // One number per line of the file, in order.
  expect(layout.cells.map((cell) => cell.number)).toEqual(['1', '2', '3']);
  // A single column: every number ends at the same x and every line starts at
  // the same x, however many digits the number has.
  expect(new Set(layout.cells.map((cell) => cell.gutterRight)).size).toBe(1);
  expect(new Set(layout.cells.map((cell) => cell.lineLeft)).size).toBe(1);
  // The numbers are not part of what a selection takes.
  expect(layout.cells.map((cell) => cell.selectable)).toEqual(['none', 'none', 'none']);
  // The 400-character line did not wrap: its row is exactly as tall as the short
  // one, and the column scrolls sideways instead.
  expect(new Set(layout.cells.map((cell) => cell.rowHeight)).size).toBe(1);
  expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);

  // The colours, as the browser resolved them. The three values are the palette's
  // own hexes (`index.css`'s `--color-code-*`, which are the prototype's), restated
  // here on purpose: the point of asking a browser is that the token reaches the
  // paint at all — a class that no stylesheet turns into a colour fails this, and
  // it is the one check the palette cannot have anywhere else.
  const tone = (text: string): Promise<string> =>
    page
      .getByText(text, { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
  expect(await tone('const')).toBe('rgb(199, 146, 234)');
  expect(await tone('42')).toBe('rgb(224, 167, 107)');
  expect(await tone(`// ${'a'.repeat(400)}`)).toBe('rgb(91, 104, 118)');

  // Clean up.
  await page.getByRole('button', { name: `Actions for ${NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm delete' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('button', { name: NAME, exact: true })).toHaveCount(0);
});
