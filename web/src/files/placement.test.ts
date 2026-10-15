import { describe, expect, it } from 'vitest';

import { MENU_GAP, menuPlacement, type MenuPlacement, type Span } from './placement';

/**
 * The row menu's placement rule, at the boundary jsdom cannot reach: the
 * geometry is passed in, so "the drawer's last row" is a pair of numbers here
 * rather than a rendered box, and the browser check is left with the one thing
 * numbers cannot say — that the boxes are where they are.
 *
 * `FilePanel.test.tsx` pins the other half of it: that the menu is still a child
 * of its row, which is the containing block the placement is expressed against.
 */

/** The tree column's scroller: 300px tall, as the drawer's 42vh leaves it. */
const CLIP: Span = { top: 0, bottom: 300 };

/** A two-entry menu: 48px of padding, border and two lines. */
const MENU_HEIGHT = 48;

/** What the panel asks of the rule, with the same gap the classes carry. */
function place(row: Span, menuHeight: number = MENU_HEIGHT): MenuPlacement {
  return menuPlacement(row, CLIP, menuHeight, MENU_GAP);
}

describe('menuPlacement', () => {
  it('opens downward while the scroller has room under the row', () => {
    expect(place({ top: 80, bottom: 100 })).toBe('below');
    expect(place({ top: 0, bottom: 20 })).toBe('below');
  });

  it('measures the room, not the row: exactly enough still opens downward', () => {
    // The menu fits whole with 48px between the row's foot and the scroller's.
    expect(place({ top: 228, bottom: 248 })).toBe('below');
    // One pixel less of room and it would be cut off, so it opens up.
    expect(place({ top: 229, bottom: 249 })).toBe('above');
  });

  it('counts its gap on the side it opens to', () => {
    // 48px of room under the row: enough for the menu, not for the menu and the
    // clearance it keeps from the row, so the panel's own call flips it up.
    const row = { top: 226, bottom: 252 };
    expect(place(row)).toBe('above');
    // The rule is told the gap rather than assuming one, so with no clearance to
    // pay the same room fits.
    expect(menuPlacement(row, CLIP, MENU_HEIGHT, 0)).toBe('below');
  });

  it("flips the drawer's last rows up, where the scroller leaves no room below", () => {
    // The last row of the tree: flush with the scroller's foot and its padding.
    expect(place({ top: 272, bottom: 296 })).toBe('above');
    // The row above it: 24px of room under it, still short of the menu.
    expect(place({ top: 248, bottom: 272 })).toBe('above');
  });

  it('picks the roomier side when neither one fits, and downward on a tie', () => {
    // A menu taller than the whole scroller: the row's own ends decide.
    expect(place({ top: 280, bottom: 300 }, 400)).toBe('above');
    expect(place({ top: 0, bottom: 20 }, 400)).toBe('below');
    // 133px above and 133px below a mid-panel row: the tie goes the common way.
    expect(place({ top: 137, bottom: 163 }, 200)).toBe('below');
  });

  it('leaves a panel that measures nothing on the downward default', () => {
    // jsdom's every box is 0×0: no room on either side, so the rendered menu
    // tests go on seeing the ordinary menu, positioned by the CSS classes.
    expect(menuPlacement({ top: 0, bottom: 0 }, { top: 0, bottom: 0 }, 0, MENU_GAP)).toBe('below');
  });
});
