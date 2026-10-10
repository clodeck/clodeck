import type { Project } from '@clodeck/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  baseName,
  idleListing,
  joinPath,
  listingError,
  listingLoading,
  listingReady,
  noPreview,
  parentPath,
  previewLoading,
  previewOf,
  viewerOf,
  type FileViewer,
  type ListingState,
  type PreviewState,
} from './reducer';
import { createEntry, fetchContent, fetchEntries, removeEntry, renameEntry, uploadEntry } from './transport';

/**
 * The file drawer's data seam, shaped like `useChat` / `useTerminal`: one
 * discriminated view union and one record of actions, with all the `fetch`ing
 * and the mutation sequencing owned here. The panel below it is declarative.
 *
 * The listing is a `useEffect` keyed on the current relative `path` and a
 * re-list counter — the same idiom `useProjects`/`useSessions` use — while the
 * preview is its own request stamped with a token, so a slow read of file A can
 * never land on top of a newer read of file B.
 *
 * `path` is always **relative to the project root** (`''` is the root); no
 * absolute path and no decoded id is ever held here (spec-04 §"Web client").
 */

export type { FileViewer, PreviewState } from './reducer';

/** The drawer's mutations, one method per user-facing operation (spec-04 §"Web client"). */
export interface FileViewerActions {
  /** Descend into a directory addressed by its root-relative `path`. */
  open(path: string): void;
  /** Ascend one level; the root is its own parent. */
  up(): void;
  /** Re-list the current directory. */
  refresh(): void;
  /** Read a file addressed by its root-relative `path` into the preview. */
  preview(path: string): void;
  /** Create a bare `name` inside the current directory. */
  create(kind: 'file' | 'directory', name: string): Promise<void>;
  /** Rename the entry at `path` to the bare name `to`. */
  rename(path: string, to: string): Promise<void>;
  /** Delete the entry at `path` (the panel confirms first). */
  remove(path: string): Promise<void>;
  /** Upload `file` to the root-relative destination `path`. */
  upload(path: string, file: File): Promise<void>;
}

export interface FileViewerController {
  viewer: FileViewer;
  actions: FileViewerActions;
}

export function useFiles(project: Project): FileViewerController {
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<ListingState>(idleListing);
  const [preview, setPreview] = useState<PreviewState>(noPreview);
  // Bumping this re-runs the listing effect for the same path.
  const [attempt, setAttempt] = useState(0);
  // Stamps the newest preview request; an older response that lands late is dropped.
  const previewRequest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    // A new directory (or a re-list after a mutation) invalidates any preview.
    previewRequest.current += 1;
    setListing(listingLoading(path));
    setPreview(noPreview);

    fetchEntries(project.id, path, controller.signal).then(
      (entries) => {
        if (!controller.signal.aborted) setListing(listingReady(path, entries));
      },
      (error: unknown) => {
        // An aborted request is this effect being replaced, not a failure.
        if (!controller.signal.aborted) setListing(listingError(path, messageOf(error)));
      },
    );

    return () => controller.abort();
  }, [project.id, path, attempt]);

  const open = useCallback((next: string): void => {
    setPath(next);
  }, []);

  const up = useCallback((): void => {
    setPath((current) => parentPath(current));
  }, []);

  const refresh = useCallback((): void => {
    setAttempt((count) => count + 1);
  }, []);

  const readPreview = useCallback(
    (filePath: string): void => {
      const token = (previewRequest.current += 1);
      setPreview(previewLoading(baseName(filePath)));
      fetchContent(project.id, filePath).then(
        (content) => {
          if (previewRequest.current === token) setPreview(previewOf(baseName(filePath), content));
        },
        (error: unknown) => {
          // A failed read is surfaced like any other error; a re-list recovers.
          if (previewRequest.current === token) setListing(listingError(path, messageOf(error)));
        },
      );
    },
    [project.id, path],
  );

  /**
   * One place every mutation goes through: a success re-lists the current
   * directory (the drawer must reflect what just changed), a failure is surfaced
   * as the viewer's error arm — a `409`/`413`/`400` is data, not a throw.
   */
  const runMutation = useCallback(
    async (operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
        setAttempt((count) => count + 1);
      } catch (error: unknown) {
        setListing(listingError(path, messageOf(error)));
      }
    },
    [path],
  );

  const create = useCallback(
    (kind: 'file' | 'directory', name: string): Promise<void> =>
      runMutation(() => createEntry(project.id, joinPath(path, name), kind)),
    [project.id, path, runMutation],
  );

  const rename = useCallback(
    (target: string, to: string): Promise<void> => runMutation(() => renameEntry(project.id, target, to)),
    [project.id, runMutation],
  );

  const remove = useCallback(
    (target: string): Promise<void> => runMutation(() => removeEntry(project.id, target)),
    [project.id, runMutation],
  );

  const upload = useCallback(
    (target: string, file: File): Promise<void> => runMutation(() => uploadEntry(project.id, target, file)),
    [project.id, runMutation],
  );

  const viewer = viewerOf(listing, preview);

  return {
    viewer,
    actions: { open, up, refresh, preview: readPreview, create, rename, remove, upload },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
