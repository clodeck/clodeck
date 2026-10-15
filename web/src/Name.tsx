import type { ReactElement } from 'react';

/**
 * A name drawn as a name, reading in its own direction (ticket 56).
 *
 * A name is the one part of a row whose script the shell does not choose:
 * `یادداشت.md` is Persian and has to read right-to-left, which in a row laid out
 * left-to-right it does not — the name's own parts land on the wrong sides of
 * each other. `dir="auto"` is the browser's rule for exactly this: the name's
 * first *strong* character decides its direction, so a leading digit, punctuation
 * mark or emoji decides nothing and a name with no strong character at all stays
 * left-to-right, as it is today.
 *
 * It is set on the name's own element and never on the row, the listing or the
 * panel. On the row, the first strong character of `123-…` would decide the
 * direction of everything on it — the folder's `▸`, the size, the `⋯`, the
 * indentation — and of the rows beside it. Here, none of that moves.
 */
export function Name({ children }: { children: string }): ReactElement {
  return <span dir="auto">{children}</span>;
}
