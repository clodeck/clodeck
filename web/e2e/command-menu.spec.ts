import { expect, test, type Page } from '@playwright/test';

import { login, removeRow } from './support';

/**
 * The composer's `/` menu, in a real browser (ticket 75).
 *
 * The rendered suite drives every state the menu has — the filter, the keys, the
 * insert — but a menu is also *boxes and focus*: that the panel lands above the
 * box rather than over it, that a chosen command leaves the caret in the box at
 * the end of what was inserted, and that the line under the box and the keys
 * above it agree while the panel is open. jsdom computes no boxes, so those are
 * this spec's business.
 *
 * A command is a markdown file under `.claude/commands`, so the spec makes one
 * and takes it away again — creating only the directories it had to create and
 * removing only those, because the project it drives is the developer's own.
 */

const COMMAND = 'zz-e2e-menu.md';

test('the / menu offers a project command, filters it, inserts it, and shuts on Escape', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'demo', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('section[aria-label="Files"]')).toBeVisible();

  const tree = new FolderTree(page);
  await tree.useFlatList();

  // The fixture: `.claude/commands/zz-e2e-menu.md`, made through the drawer the
  // user has, so the file the menu offers is one anybody could have written.
  await tree.ensure('.claude');
  await tree.ensure('commands');
  await page.setInputFiles('input[aria-label="Choose files to upload"]', {
    name: COMMAND,
    mimeType: 'text/markdown',
    buffer: Buffer.from('A command /zz-e2e-menu should be offered for.\n'),
  });
  await expect(page.getByRole('status')).toHaveText(`uploaded ${COMMAND}`);
  tree.made(`${COMMAND}`);

  await tree.root();

  const box = page.getByLabel('Message');
  const menu = page.getByRole('listbox', { name: 'Commands' });
  // A file that declares no description is a row that is its name alone — no
  // blank to read, and nothing invented to fill it.
  const row = menu.getByRole('option', { name: '/zz-e2e-menu' });

  await box.click();
  await box.press('/');
  await expect(menu).toBeVisible();
  // The hint under the box documents the keys above it, and with the panel open
  // "Enter to send" is not what Enter does.
  await expect(page.getByText('↑↓ to choose · Enter or Tab to insert · Esc to close')).toBeVisible();

  // The panel sits *above* the box, not over it: it covers the transcript, never
  // the line being typed.
  const [panel, input] = await Promise.all([
    menu.boundingBox(),
    box.boundingBox(),
  ]);
  expect(panel).not.toBeNull();
  expect(input).not.toBeNull();
  expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBeLessThanOrEqual(input?.y ?? 0);

  // Typing narrows it, by substring rather than by prefix.
  await box.pressSequentially('e2e');
  await expect(menu.getByRole('option')).toHaveCount(1);
  await expect(row).toBeVisible();

  // Enter takes the highlighted row, and does not send: the box keeps the
  // command, the caret and the focus, which is what makes the argument that
  // follows the user's to type.
  await box.press('Enter');
  await expect(box).toHaveValue(`/zz-e2e-menu `);
  await expect(menu).toHaveCount(0);
  await expect(box).toBeFocused();
  expect(
    await box.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) throw new Error('the composer is not a textarea');
      return element.selectionStart;
    }),
  ).toBe('/zz-e2e-menu '.length);
  await expect(page.getByText('Enter to send · Shift+Enter for a newline')).toBeVisible();

  // Escape shuts the panel and leaves the text where it was, so the menu can be
  // waved away without retyping what opened it.
  await box.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(box).toHaveValue('/zz-e2e-menu ');

  // A box emptied and slashed again is a new command being typed rather than the
  // one that was dismissed, so the panel comes back for it.
  await box.fill('');
  await box.press('/');
  await expect(menu).toBeVisible();

  await tree.cleanUp();
});

/**
 * The drawer's flat list, driven by the same handles a person uses: the folder
 * rows name what opening them does, and the create and upload buttons land in
 * whichever folder is open.
 *
 * It remembers what the spec made, so the project is left exactly as it was
 * found — a folder that was already there is never removed.
 */
class FolderTree {
  /** Everything this spec created, in creation order, relative to the project root. */
  private readonly created: string[] = [];
  /** The open folder, relative to the project root; `''` is the root itself. */
  private at = '';

  constructor(private readonly page: Page) {}

  /** The flat list, where a folder's row says which folder it opens. */
  async useFlatList(): Promise<void> {
    await this.page.getByRole('button', { name: 'List', exact: true }).click();
  }

  /** Remember the last thing this spec made — the upload, which takes no dialog. */
  made(relative: string): void {
    this.created.push(this.path(relative));
  }

  /**
   * Open `name`, creating it when the project does not have one.
   *
   * Asking the drawer to create the folder is how the question is asked: for a
   * folder that was already there it answers "already exists", and that answer
   * is information rather than a failure — the folder is not this spec's, and
   * not its to remove. It is also the only question here that *waits*: a listing
   * that has not painted yet cannot be asked whether a row is in it.
   */
  async ensure(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'New Folder', exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: 'New folder' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();

    const made = await Promise.race([
      dialog.waitFor({ state: 'detached' }).then(() => true),
      dialog.getByText('already exists').waitFor({ state: 'visible' }).then(() => false),
    ]);
    if (made) this.created.push(this.path(name));
    else await dialog.getByRole('button', { name: 'Cancel' }).click();

    await this.page.getByTitle(`Open folder ${name}`).click();
    this.at = this.path(name);
  }

  /** Back to the project root, a step at a time — the trail is the only way up. */
  async root(): Promise<void> {
    while (this.at !== '') {
      await this.open(this.at.split('/').slice(0, -1).join('/'));
    }
  }

  /** Take back what this spec made, deepest first. */
  async cleanUp(): Promise<void> {
    for (const path of [...this.created].reverse()) {
      await this.open(path.split('/').slice(0, -1).join('/'));
      await removeRow(this.page, nameOf(path));
    }
    this.created.length = 0;
  }

  /** Stand in `directory`, relative to the project root, opening each step. */
  private async open(directory: string): Promise<void> {
    // The root crumb is a *button* only while it is somewhere behind us; standing
    // at the root already, there is nothing to click.
    if (this.at !== '') {
      await this.page.getByRole('navigation', { name: 'Folder' }).getByRole('button', { name: 'root' }).click();
      this.at = '';
    }
    for (const step of directory === '' ? [] : directory.split('/')) {
      await this.page.getByTitle(`Open folder ${step}`).click();
      this.at = this.path(step);
    }
  }

  private path(relative: string): string {
    return this.at === '' ? relative : `${this.at}/${relative}`;
  }
}

function nameOf(path: string): string {
  return path.split('/').at(-1) ?? path;
}
