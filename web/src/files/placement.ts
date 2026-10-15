/**
 * Which edge of its row a menu hangs from (ticket 55).
 *
 * A row is its menu's containing block (`relative`), so the menu is placed
 * against the row however the two are arranged; what is left to decide is
 * whether it opens *below* the row or *above* it. The drawer is a 42vh strip
 * with its own scroller, so the last row or two of the tree have no room under
 * them — and a menu drawn past the scroller's edge is not overlapped, it is cut
 * off, which is what made the `⋯` look broken on exactly those rows.
 *
 * The decision is pure and lives here, apart from the reading of the boxes:
 * jsdom computes no layout at all, so the panel supplies the numbers from
 * `getBoundingClientRect` and this file decides what they mean.
 */

/** Which edge of its row a menu hangs from. */
export type MenuPlacement = 'below' | 'above';

/** The vertical part of a box — a `DOMRect` read as the two numbers a placement needs. */
export interface Span {
  top: number;
  bottom: number;
}

/** The menu's clearance from its row: the same `mt-1` / `mb-1`, whichever side it opens. */
export const MENU_GAP = 4;

/**
 * Where the menu goes, given the row's span, the span of the box that would clip
 * it (the tree column's scroller), and the menu's own height. The gap is paid on
 * both sides, so a menu exactly as tall as the room below it still opens
 * downward — the common case is the one that must not change.
 *
 * With room on neither side (a drawer shorter than the menu either way) it opens
 * toward the roomier one, so the scroller cuts off the least of it. Equal rooms
 * go downward, the same as the tie above.
 */
export function menuPlacement(row: Span, clip: Span, menuHeight: number, gap: number): MenuPlacement {
  const below = clip.bottom - row.bottom - gap;
  if (below >= menuHeight) return 'below';
  const above = row.top - clip.top - gap;
  if (above >= menuHeight) return 'above';
  return above > below ? 'above' : 'below';
}
