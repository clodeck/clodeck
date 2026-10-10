import type { FileContent, FileEntry } from '@clodeck/shared';

/**
 * The file drawer's view model and its pure transitions — the parts of the
 * `useFiles` seam that carry no socket, no `fetch`, and no DOM, so the tree,
 * preview and editing rules are testable under the node test environment (the
 * chat slice's `reducer.ts` is the same split).
 *
 * Two views are pinned here, both as discriminated unions so a renderer over
 * them is an exhaustive `switch` ending in {@link assertNever}:
 *
 * - {@link FileViewer} — the whole drawer (the tree plus the preview), folded
 *   from the two halves below by {@link viewerOf}.
 * - {@link PreviewState} — the preview/editor pane alone.
 *
 * The tree half ({@link TreeState}) keeps every loaded directory keyed by its
 * root-relative path (`''` is the root), the set of expanded paths, and the
 * "active" folder that create/upload land in. Folders expand **in place** — a
 * click toggles {@link TreeState.expanded}, it never navigates — so the panel
 * renders a real tree, not a breadcrumb.
 */

/* -------------------------------------------------------------------------- */
/* Preview + editing                                                          */
/* -------------------------------------------------------------------------- */

/** The preview/editor pane, as a discriminated union on `kind`. */
export type PreviewState =
  | { kind: 'none' }
  | { kind: 'loading'; name: string; path: string }
  | { kind: 'text'; name: string; path: string; content: string; truncated: boolean }
  | { kind: 'binary'; name: string; path: string; size: number }
  | { kind: 'editing'; name: string; path: string; original: string; value: string; dirty: boolean; saving: boolean; error: string | null }
  | { kind: 'error'; name: string; path: string; message: string };

export const noPreview: PreviewState = { kind: 'none' };

export function previewLoading(name: string, path: string): PreviewState {
  return { kind: 'loading', name, path };
}

/** A read that failed — surfaced in the pane, never by collapsing the tree. */
export function previewError(name: string, path: string, message: string): PreviewState {
  return { kind: 'error', name, path, message };
}

/**
 * The file content → preview mapping. Exhaustive over `FileContent`: a new arm
 * on the wire is a compile error here, so the pane can never silently miss one.
 */
export function previewOf(name: string, path: string, content: FileContent): PreviewState {
  switch (content.kind) {
    case 'text':
      return { kind: 'text', name, path, content: content.content, truncated: content.truncated };
    case 'binary':
      return { kind: 'binary', name, path, size: content.size };
    default:
      return assertNever(content);
  }
}

/** Read-only → writable: seed the editor with the file's current content. */
export function beginEdit(preview: PreviewState): PreviewState {
  switch (preview.kind) {
    case 'text':
      // A truncated file holds only the 256 KiB prefix; editing it would clobber
      // the rest, so it stays read-only.
      if (preview.truncated) return preview;
      return {
        kind: 'editing',
        name: preview.name,
        path: preview.path,
        original: preview.content,
        value: preview.content,
        dirty: false,
        saving: false,
        error: null,
      };
    case 'none':
    case 'loading':
    case 'binary':
    case 'editing':
    case 'error':
      return preview;
    default:
      return assertNever(preview);
  }
}

/**
 * Live keystrokes. `dirty` means "differs from what was last saved"; a keystroke
 * also clears a stale save error, because the buffer is no longer what failed.
 */
export function updateEdit(preview: PreviewState, value: string): PreviewState {
  switch (preview.kind) {
    case 'editing':
      return { ...preview, value, dirty: value !== preview.original, error: null };
    case 'none':
    case 'loading':
    case 'text':
    case 'binary':
    case 'error':
      return preview;
    default:
      return assertNever(preview);
  }
}

/** The save is in flight (the editor is disabled while it is). */
export function savingEdit(preview: PreviewState): PreviewState {
  switch (preview.kind) {
    case 'editing':
      return { ...preview, saving: true, error: null };
    case 'none':
    case 'loading':
    case 'text':
    case 'binary':
    case 'error':
      return preview;
    default:
      return assertNever(preview);
  }
}

/** The save landed: the new bytes become the read-only preview. */
export function savedEdit(preview: PreviewState, content: string): PreviewState {
  switch (preview.kind) {
    case 'editing':
      return { kind: 'text', name: preview.name, path: preview.path, content, truncated: false };
    case 'none':
    case 'loading':
    case 'text':
    case 'binary':
    case 'error':
      return preview;
    default:
      return assertNever(preview);
  }
}

/** The save failed: keep the buffer for a retry and surface the message. */
export function saveFailedEdit(preview: PreviewState, message: string): PreviewState {
  switch (preview.kind) {
    case 'editing':
      return { ...preview, saving: false, error: message };
    case 'none':
    case 'loading':
    case 'text':
    case 'binary':
    case 'error':
      return preview;
    default:
      return assertNever(preview);
  }
}

/** Writable → read-only, back to the original content. */
export function cancelEdit(preview: PreviewState): PreviewState {
  switch (preview.kind) {
    case 'editing':
      return { kind: 'text', name: preview.name, path: preview.path, content: preview.original, truncated: false };
    case 'none':
    case 'loading':
    case 'text':
    case 'binary':
    case 'error':
      return preview;
    default:
      return assertNever(preview);
  }
}

/** The root-relative path a preview is showing, or `null` for the empty pane. */
export function previewPath(preview: PreviewState): string | null {
  switch (preview.kind) {
    case 'none':
      return null;
    case 'loading':
    case 'text':
    case 'binary':
    case 'editing':
    case 'error':
      return preview.path;
    default:
      return assertNever(preview);
  }
}

/* -------------------------------------------------------------------------- */
/* The tree                                                                   */
/* -------------------------------------------------------------------------- */

/** One directory's fetched listing, keyed by root-relative path (`''` is the root). */
export type DirListing =
  | { status: 'loading' }
  | { status: 'ready'; entries: FileEntry[] }
  | { status: 'error'; message: string };

/** The listing/tree half of the drawer, before the preview is folded in. */
export type TreeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; dirs: Record<string, DirListing>; expanded: Record<string, true>; active: string }
  | { status: 'error'; message: string };

/** The drawer's whole state, as a discriminated union on `status`. */
export type FileViewer =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; dirs: Record<string, DirListing>; expanded: Record<string, true>; active: string; preview: PreviewState }
  | { status: 'error'; message: string };

export function idleTree(): TreeState {
  return { status: 'idle' };
}

export function treeLoading(): TreeState {
  return { status: 'loading' };
}

/** The root has loaded: the tree is ready with exactly one directory, the root. */
export function treeReady(root: readonly FileEntry[]): TreeState {
  return { status: 'ready', dirs: { '': dirReady(root) }, expanded: {}, active: '' };
}

export function treeError(message: string): TreeState {
  return { status: 'error', message };
}

export function dirLoading(): DirListing {
  return { status: 'loading' };
}

/** A listing lands already sorted, so the panel renders in order without re-sorting. */
export function dirReady(entries: readonly FileEntry[]): DirListing {
  return { status: 'ready', entries: sortEntries(entries) };
}

export function dirError(message: string): DirListing {
  return { status: 'error', message };
}

/** Upsert one directory's listing; a no-op outside the `ready` status. */
export function withDir(tree: TreeState, path: string, listing: DirListing): TreeState {
  switch (tree.status) {
    case 'ready':
      return { ...tree, dirs: { ...tree.dirs, [path]: listing } };
    case 'idle':
    case 'loading':
    case 'error':
      return tree;
    default:
      return assertNever(tree);
  }
}

/** Expand or collapse a directory (fetching the listing is the hook's job). */
export function withExpanded(tree: TreeState, path: string, isExpanded: boolean): TreeState {
  switch (tree.status) {
    case 'ready': {
      const expanded = { ...tree.expanded };
      if (isExpanded) expanded[path] = true;
      else delete expanded[path];
      return { ...tree, expanded };
    }
    case 'idle':
    case 'loading':
    case 'error':
      return tree;
    default:
      return assertNever(tree);
  }
}

/** Select the folder create/upload land in (the last folder clicked). */
export function withActive(tree: TreeState, path: string): TreeState {
  switch (tree.status) {
    case 'ready':
      return { ...tree, active: path };
    case 'idle':
    case 'loading':
    case 'error':
      return tree;
    default:
      return assertNever(tree);
  }
}

/** Fold the tree and the preview into the single pinned {@link FileViewer}. */
export function viewerOf(tree: TreeState, preview: PreviewState): FileViewer {
  switch (tree.status) {
    case 'idle':
      return { status: 'idle' };
    case 'loading':
      return { status: 'loading' };
    case 'ready':
      return { status: 'ready', dirs: tree.dirs, expanded: tree.expanded, active: tree.active, preview };
    case 'error':
      return { status: 'error', message: tree.message };
    default:
      return assertNever(tree);
  }
}

/* -------------------------------------------------------------------------- */
/* Paths — relative to the project root, `''` is the root                     */
/* -------------------------------------------------------------------------- */

/** Appends one segment to a relative directory path. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/** The final segment of a relative path. */
export function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/** The parent directory of a relative path; the root is its own parent. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
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
 * drawer's reading order. A new array, so the caller's listing is never
 * reordered underneath it. The server already sorts, but the panel must not
 * depend on that order.
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
