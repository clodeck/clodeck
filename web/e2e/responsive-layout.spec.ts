import { expect, test, type Page } from '@playwright/test';

import { removeRow, signIn } from './support';

/**
 * The phone layout (ticket 77), in a real browser.
 *
 * jsdom runs no media query and lays nothing out, so the rendered suite can pin
 * the overlay's open/closed state but never the thing the ticket is about: that
 * at 360px the rail is a bottom nav, the sidebar is off canvas until summoned,
 * the drawer covers the stage, and nothing scrolls sideways. Those are boxes and
 * computed styles, and this is the one place they exist.
 *
 * 360×640 is the ticket's floor; the same numbers are what the assertions use.
 */

const WIDTH = 360;
const HEIGHT = 640;

test.use({ viewport: { width: WIDTH, height: HEIGHT } });

/**
 * The page must never be wider than its viewport. Every surface in the ticket —
 * the chat, history, the file drawer, the terminal — is opened before this is
 * asked, because an overflow is a child's property and it arrives late.
 */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.viewport).toBe(WIDTH);
  expect(Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport);
}

test('the shell reflows to a bottom nav, an overlay sidebar, and a full-screen drawer', async ({
  page,
}) => {
  // `login` waits for the project row, which is exactly what this layout parks
  // off canvas: at 360px the workspace's own door is the thing to wait for.
  await signIn(page);
  const door = page.getByRole('button', { name: 'Open projects' });
  await expect(door).toBeVisible();

  // --- The phone shell -----------------------------------------------------
  // The rail is the row along the bottom now, and it kept its three actions.
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  for (const name of ['Chat', 'Terminal', 'Files']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // The row spans the width and ends at the bottom edge. The rail it replaced
  // was a 52px column down the left, so this is what says it reflowed.
  const navBox = await nav.boundingBox();
  if (navBox === null) throw new Error('the bottom nav drew nothing');
  expect(navBox.x).toBe(0);
  expect(navBox.width).toBe(WIDTH);
  expect(navBox.y + navBox.height).toBe(HEIGHT);

  // The sidebar is off canvas until its door is used: the project row has
  // landed in the document, but a phone cannot see it and cannot tap it. The
  // `toBeAttached` is load-bearing — `toBeHidden` alone also passes for a row
  // the list has not delivered yet, which would make this assertion vacuous.
  // `includeHidden` is what makes that assertion possible: the closed sidebar
  // is `visibility: hidden`, and a role locator otherwise matches only what is
  // in the accessibility tree, where the row is not yet.
  const projectRow = page.getByRole('button', { name: 'demo', exact: true, includeHidden: true });
  await expect(projectRow).toBeAttached();
  await expect(projectRow).toBeHidden();
  await expectNoHorizontalScroll(page);

  // --- The overlay's door and its scrim ------------------------------------
  await door.click();
  await expect(projectRow).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The scrim is the way back: the overlay shuts and takes its row with it.
  // Its centre is under the 288px sidebar, so the tap lands on the exposed
  // strip to the right — the part of the scrim a thumb actually reaches.
  await page
    .getByRole('button', { name: 'Close projects' })
    .click({ position: { x: WIDTH - 12, y: HEIGHT / 2 } });
  await expect(projectRow).toBeHidden();

  // --- A project pick also shuts it ----------------------------------------
  await door.click();
  await projectRow.click();
  await expect(projectRow).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('demo');

  // --- Escape also shuts it ------------------------------------------------
  await door.click();
  await expect(projectRow).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(projectRow).toBeHidden();

  // --- History, over the width -------------------------------------------
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close session history' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(WIDTH);
  await page.getByRole('button', { name: 'Close session history' }).click();

  // --- The drawer is a full-screen sheet ----------------------------------
  const drawer = page.locator('section[aria-label="Drawer"]');
  const box = async (): Promise<{ x: number; y: number; width: number; height: number }> => {
    const bounds = await drawer.boundingBox();
    if (bounds === null) throw new Error('the drawer drew nothing');
    return bounds;
  };

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(drawer).toBeVisible();
  await expect(page.locator('section[aria-label="Terminal"]')).toBeVisible();
  // The sheet is the whole viewport, not the 42vh strip the desktop gets.
  expect(await box()).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  // And what it covers is the stage: the midpoint of the screen belongs to the
  // drawer, with the chat still mounted behind it rather than unmounted.
  expect(
    await page.evaluate(() => {
      const atPoint = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return atPoint?.closest('section[aria-label="Drawer"]') !== null;
    }),
  ).toBe(true);
  await expectNoHorizontalScroll(page);

  // Its own control shuts it, and the chat (and its composer) come back.
  await page.getByRole('button', { name: 'Close drawer' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();

  // --- The file drawer is the same sheet ----------------------------------
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();
  expect(await box()).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  await expectNoHorizontalScroll(page);

  // --- The file sheet leaves the file the width ---------------------------
  // The old split kept a fixed 300px tree, which at 360px left the file about
  // 60px: unreadable, and its edit chip off the edge. The tree is a sheet now,
  // and this is the one place that can see it — jsdom renders no layout.
  const FILE = 'zz-e2e-mobile.txt';
  // Long lines on purpose: a pane that is still sized by its content runs wide,
  // which is exactly how the chip used to disappear.
  await page.setInputFiles('input[aria-label="Choose files to upload"]', {
    name: FILE,
    mimeType: 'text/plain',
    buffer: Buffer.from(`const x = ${'a'.repeat(200)};\nsecond line\n`),
  });
  await expect(page.getByRole('status')).toHaveText(`uploaded ${FILE}`);

  // The list is the sheet on landing, over a file pane that has nothing yet.
  await expect(page.getByRole('button', { name: 'Close file list' })).toBeVisible();

  await page.getByRole('button', { name: FILE, exact: true }).click();

  // Picking a file hands it the width and puts the sheet away.
  await expect(page.getByRole('button', { name: 'Close file list' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Browse', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Source' })).toBeVisible();

  // The code head — path, Download, the read-only chip — is inside the screen,
  // not pushed past its right edge by a long line.
  const head = await page.evaluate((file) => {
    // The panel has two heads: the tree's, and the code column's, which names
    // the open file. This is the second one.
    const header =
      Array.from(document.querySelectorAll('section[aria-label="Files"] header')).find((candidate) =>
        candidate.textContent?.includes(file),
      ) ?? null;
    if (header === null) return null;
    const bounds = header.getBoundingClientRect();
    return { width: Math.round(bounds.width), right: Math.round(bounds.right) };
  }, FILE);
  expect(head).not.toBeNull();
  expect(head?.width).toBe(WIDTH);
  expect(head?.right).toBeLessThanOrEqual(WIDTH);
  await expect(page.getByRole('button', { name: 'read-only', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Browse brings the list back; the ✕ puts it away again.
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close file list' })).toBeVisible();
  await page.getByRole('button', { name: 'Close file list' }).click();
  await expect(page.getByRole('button', { name: 'Close file list' })).toBeHidden();

  // A tap on the scrim is the third way out — the sliver of it a thumb reaches
  // to the right of the 86%-wide sheet.
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page
    .getByRole('button', { name: 'Dismiss file list' })
    .click({ position: { x: WIDTH - 8, y: HEIGHT / 2 } });
  await expect(page.getByRole('button', { name: 'Close file list' })).toBeHidden();

  // Leave the project as it was found.
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await removeRow(page, FILE);

  await page.getByRole('button', { name: 'Close drawer' }).click();

  // --- The composer is reachable at the floor width -----------------------
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  const send = await page.getByRole('button', { name: 'Send', exact: true }).boundingBox();
  if (send === null) throw new Error('the send button drew nothing');
  expect(send.x + send.width).toBeLessThanOrEqual(WIDTH);
  await expectNoHorizontalScroll(page);
});
