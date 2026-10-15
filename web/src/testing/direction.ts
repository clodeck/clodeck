/**
 * The two DOM questions ticket 56's tests ask of a rendered row — the file
 * panel's rows and the switcher's are the same shape drawn by two components,
 * so the questions live here once rather than in both test files.
 *
 * Not a test file: vitest collects `*.test.*` only.
 */

/** The element a row draws its name on: the one that carries the direction rule. */
export function nameCell(button: HTMLElement): HTMLElement {
  const cell = button.querySelector<HTMLElement>('[dir]');
  if (cell === null) throw new Error(`the row "${button.textContent ?? ''}" draws its name with no rule`);
  return cell;
}

/**
 * Every `dir` attribute on the way up from a row's button — the trap the
 * direction rule avoids by sitting on the name's own element and nowhere else,
 * where the first strong character of `123-…` would decide the whole row. A test
 * asserts this is empty.
 */
export function dirsAbove(button: HTMLElement): string[] {
  const found: string[] = [];
  for (let element: HTMLElement | null = button; element !== null; element = element.parentElement) {
    const dir = element.getAttribute('dir');
    if (dir !== null) found.push(dir);
  }
  return found;
}
