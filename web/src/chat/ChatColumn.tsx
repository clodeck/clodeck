import type { ReactElement, ReactNode } from 'react';

/**
 * The chat's column: one band, centred, `780px` at its widest (the prototype's
 * `.transcript-inner` / `.composer-inner`, `styles.css:107-108,153-173`).
 *
 * It is one component rather than the same three utilities copied into the
 * transcript, the footer and the history browser, because "the prompt box lines
 * up with the messages above it" is a *shared width* — and a shared width
 * written out repeatedly is a shared width that drifts the first time one of
 * them is touched. The chat has one left edge from top to bottom because every
 * band is this element.
 *
 * It is the column, never a surface: the full-bleed things behind it — the
 * chat's background, the header's and footer's rules, the history browser's own
 * wash — stay the width of the stage, and the band is what is centred inside
 * them. So a caller keeps its own padding-y, borders and background and wraps
 * only its *contents* here.
 *
 * `data-chat-column` is the handle the rendered test and the browser check aim
 * at. It is not a role: a layout band is not a boundary a screen reader should
 * be told about, unlike the labelled drop area ticket 48 added.
 */
export function ChatColumn({ children }: { children: ReactNode }): ReactElement {
  return (
    <div data-chat-column="" className="mx-auto w-full max-w-[780px] px-4">
      {children}
    </div>
  );
}
