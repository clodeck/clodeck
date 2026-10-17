import { expect, test, type Page } from '@playwright/test';

import { signIn } from './support';

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

/** How wide the page is right now, for a failure that names the surface. */
async function widthOf(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
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
  for (const name of ['Chat', 'Terminal', 'Files']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The sidebar is off canvas until its door is used: the project row exists,
  // but a phone cannot see it and cannot tap it.
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeHidden();
  await expectNoHorizontalScroll(page);

  // --- The overlay's door and its scrim ------------------------------------
  await door.click();
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The scrim is the way back: the overlay shuts and takes its row with it.
  // Its centre is under the 288px sidebar, so the tap lands on the exposed
  // strip to the right — the part of the scrim a thumb actually reaches.
  await page
    .getByRole('button', { name: 'Close projects' })
    .click({ position: { x: WIDTH - 12, y: HEIGHT / 2 } });
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeHidden();

  // --- A project pick also shuts it ----------------------------------------
  await door.click();
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('demo');

  // --- Escape also shuts it ------------------------------------------------
  await door.click();
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'demo', exact: true })).toBeHidden();

  // --- History, over the width -------------------------------------------
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close session history' })).toBeVisible();
  expect(await widthOf(page)).toBeLessThanOrEqual(WIDTH);
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

  // --- The file drawer, stacked rather than squeezed ----------------------
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();
  expect(await box()).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Close drawer' }).click();

  // --- The composer is reachable at the floor width -----------------------
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  const send = await page.getByRole('button', { name: 'Send', exact: true }).boundingBox();
  if (send === null) throw new Error('the send button drew nothing');
  expect(send.x + send.width).toBeLessThanOrEqual(WIDTH);
  await expectNoHorizontalScroll(page);
});
