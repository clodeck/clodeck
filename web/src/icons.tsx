import type { ReactElement } from 'react';

/**
 * The product's icon vocabulary, in one map.
 *
 * The rail's three surfaces and the file tree's toolbar draw from here rather
 * than each hand-rolling a set beside the other, so the two rows of buttons read
 * as one family: one 20px grid, one 1.5px stroke, one 18px box. An icon is
 * decoration — the button around it carries the name in its `aria-label` — so
 * every shape is `aria-hidden` and says nothing on its own.
 */
export type IconName =
  | 'chat'
  | 'terminal'
  | 'folder'
  | 'upload'
  | 'filePlus'
  | 'folderPlus'
  | 'refresh'
  | 'list';

const PATHS: Record<IconName, ReactElement> = {
  chat: (
    <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h8a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 14 14H8.5l-4 2.5V14A2.5 2.5 0 0 1 3.5 11.5z" />
  ),
  terminal: (
    <>
      <path d="M4.5 6.5 8 10l-3.5 3.5" />
      <path d="M11 13.5h4.5" />
    </>
  ),
  folder: (
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h3l1.5 2h5.5A1.5 1.5 0 0 1 16.5 8.5v5A1.5 1.5 0 0 1 15 15H5a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  upload: (
    <>
      <path d="M10 13.5V4.5" />
      <path d="M6.5 8 10 4.5 13.5 8" />
      <path d="M3.5 13.5v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2.5" />
    </>
  ),
  filePlus: (
    <>
      <path d="M5 4a1 1 0 0 1 1-1h4.5L15 7.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M10.5 3v4.5H15" />
      <path d="M10 10v4" />
      <path d="M8 12h4" />
    </>
  ),
  folderPlus: (
    <>
      <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h3l1.5 2h5.5A1.5 1.5 0 0 1 16.5 8.5v5A1.5 1.5 0 0 1 15 15H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M10 9.5v4" />
      <path d="M8 11.5h4" />
    </>
  ),
  refresh: (
    <>
      <path d="M3.75 10a6.25 6.25 0 0 1 11.35-3.6" />
      <path d="M16.25 10a6.25 6.25 0 0 1-11.35 3.6" />
      <path d="M15.1 3.4v3h-3" />
      <path d="M4.9 16.6v-3h3" />
    </>
  ),
  list: (
    <>
      <path d="M8 5h9M8 10h9M8 15h9" />
      <path d="M4 5h.01M4 10h.01M4 15h.01" />
    </>
  ),
};

/** One shape from the map: a 20×20 grid drawn at 18px, 1.5 stroke, decorative. */
export function Icon({ name }: { name: IconName }): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
    >
      {PATHS[name]}
    </svg>
  );
}
