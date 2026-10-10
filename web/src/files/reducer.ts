import type { FileContent, FileEntry } from '@clodeck/shared';

/**
 * The file drawer's view model and its pure transitions — the parts of the
 * `useFiles` seam that carry no socket, no `fetch`, and no DOM, so the listing
 * and preview rules are testable under the node test environment (the chat
 * slice's `reducer.ts` is the same split).
 *
 * The two pinned unions (spec-04 §"Web client") are the wire between the seam
 * and the panel:
 *
 * - {@link FileViewer} — the whole drawer state (listing + preview).
 * - {@link PreviewState} — the preview pane alone, nested inside `ready`.
 *
 * The `ListingState` below is the seam's own split: the preview outlives a
 * listing refresh, so keeping them as two values and folding them with
 * {@link viewerOf} means a re-list never has to reconstruct a preview it did not
 * touch.
 */

/** One row's preview, as a discriminated union on `kind` (spec-04 §"Web client"). */
export type PreviewState =
  | { kind: 'none' }
  | { kind: 'loading'; name: string }
  | { kind: 'text'; name: string; content: string; truncated: boolean }
  | { kind: 'binary'; name: string; size: number };

/** The drawer's whole state, as a discriminated union on `status`. */
export type FileViewer =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; entries: FileEntry[]; preview: PreviewState }
  | { status: 'error'; path: string; message: string };

/** The listing half of {@link FileViewer}, before the preview is folded in. */
export type ListingState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; entries: FileEntry[] }
  | { status: 'error'; path: string; message: string };

export function idleListing(): ListingState {
  return { status: 'idle' };
}

export function listingLoading(path: string): ListingState {
  return { status: 'loading', path };
}

/** A listing lands already sorted, so the panel renders in order without re-sorting. */
export function listingReady(path: string, entries: readonly FileEntry[]): ListingState {
  return { status: 'ready', path, entries: sortEntries(entries) };
}

export function listingError(path: string, message: string): ListingState {
  return { status: 'error', path, message };
}

/** Folds the listing and the preview into the single pinned {@link FileViewer}. */
export function viewerOf(listing: ListingState, preview: PreviewState): FileViewer {
  switch (listing.status) {
    case 'idle':
      return { status: 'idle' };
    case 'loading':
      return { status: 'loading', path: listing.path };
    case 'ready':
      return { status: 'ready', path: listing.path, entries: listing.entries, preview };
    case 'error':
      return { status: 'error', path: listing.path, message: listing.message };
    default:
      return assertNever(listing);
  }
}

/** The directory the viewer is showing, for the actions that address it. */
export function viewerPath(viewer: FileViewer): string {
  switch (viewer.status) {
    case 'idle':
      return '';
    case 'loading':
    case 'ready':
    case 'error':
      return viewer.path;
    default:
      return assertNever(viewer);
  }
}

export const noPreview: PreviewState = { kind: 'none' };

export function previewLoading(name: string): PreviewState {
  return { kind: 'loading', name };
}

/**
 * The file content → preview mapping. Exhaustive over `FileContent`: a new arm
 * on the wire is a compile error here, so the pane can never silently miss one.
 */
export function previewOf(name: string, content: FileContent): PreviewState {
  switch (content.kind) {
    case 'text':
      return { kind: 'text', name, content: content.content, truncated: content.truncated };
    case 'binary':
      return { kind: 'binary', name, size: content.size };
    default:
      return assertNever(content);
  }
}

/* -------------------------------------------------------------------------- */
/* Paths — relative to the project root, `''` is the root                     */
/* -------------------------------------------------------------------------- */

/** Appends one segment to a relative directory path. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/** The parent directory of a relative path; the root is its own parent. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** The final segment of a relative path. */
export function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

export interface Crumb {
  name: string;
  /** The cumulative relative path from the root to this segment. */
  path: string;
}

/** The clickable trail from the root to `path`. */
export function breadcrumb(path: string): Crumb[] {
  if (path === '') return [];
  const crumbs: Crumb[] = [];
  let cumulative = '';
  for (const segment of path.split('/')) {
    cumulative = joinPath(cumulative, segment);
    crumbs.push({ name: segment, path: cumulative });
  }
  return crumbs;
}

/**
 * Whether a name is safe to offer as a new file/folder/rename target: a single
 * non-empty segment, never `.`/`..`, no separator, no NUL. This is the panel's
 * cheap refusal; the server re-validates through its own `name()` brand.
 */
export function isValidName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  return !name.includes('/') && !name.includes('\\') && !name.includes('\0');
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Directories first, then everything else, each group by name ascending — the
 * drawer's reading order (spec-04 §"User Stories" 13). A new array, so the
 * caller's listing is never reordered underneath it.
 */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    const leftDir = left.type === 'directory' ? 0 : 1;
    const rightDir = right.type === 'directory' ? 0 : 1;
    if (leftDir !== rightDir) return leftDir - rightDir;
    if (left.name < right.name) return -1;
    return left.name > right.name ? 1 : 0;
  });
}

/** The compile-time exhaustiveness guard every `switch` over a closed union ends in. */
export function assertNever(value: never): never {
  throw new Error(`unhandled file-drawer arm: ${JSON.stringify(value)}`);
}
