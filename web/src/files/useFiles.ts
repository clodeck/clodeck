import type { Project } from '@clodeck/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  baseName,
  beginEdit,
  cancelEdit,
  dirError,
  dirLoading,
  dirReady,
  idleTree,
  joinPath,
  noPreview,
  parentPath,
  previewError,
  previewLoading,
  previewOf,
  previewPath,
  savedEdit,
  saveFailedEdit,
  savingEdit,
  treeError,
  treeLoading,
  treeReady,
  updateEdit,
  viewerOf,
  withActive,
  withDir,
  withExpanded,
  type FileViewer,
  type PreviewState,
  type TreeState,
} from './reducer';
import {
  createEntry,
  fetchContent,
  fetchEntries,
  removeEntry,
  renameEntry,
  saveContent,
  uploadEntry,
} from './transport';

/**
 * The file drawer's data seam, shaped like `useChat` / `useTerminal`: one
 * discriminated view union and one record of actions, with all the `fetch`ing
 * and the mutation sequencing owned here. The panel below it is declarative.
 *
 * Unlike the first cut (one `path` + descend/ascend), the drawer now holds a
 * **tree**: every loaded directory keyed by root-relative path, plus the set of
 * expanded paths and the "active" folder that create/upload land in. A folder
 * click toggles {@link TreeState.expanded} and lazy-loads that folder's listing
 * on first expand — it never navigates. The preview/editor is its own request
 * stamped with a token, so a slow read of file A can never land on top of a
 * newer read of file B.
 *
 * `path` is always **relative to the project root** (`''` is the root); no
 * absolute path and no decoded id is ever held here.
 */

export type { FileViewer, PreviewState } from './reducer';

/** The drawer's mutations, one method per user-facing operation. */
export interface FileViewerActions {
  /** Expand/collapse a folder in place (lazy-loads its listing on first open). */
  toggle(path: string): void;
  /** Read a file into the preview. */
  preview(path: string): void;
  /** Re-list the root and every expanded folder. */
  refresh(): void;
  /** Create a bare `name` inside the active folder. */
  create(kind: 'file' | 'directory', name: string): Promise<void>;
  /** Rename the entry at `path` to the bare name `to`. */
  rename(path: string, to: string): Promise<void>;
  /** Delete the entry at `path` (the panel confirms first). */
  remove(path: string): Promise<void>;
  /** Upload `file` into the active folder. */
  upload(file: File): Promise<void>;
  /** Read-only → writable (no-op unless the preview is a text file). */
  edit(): void;
  /** Live editor keystrokes. */
  editValue(value: string): void;
  /** Save the edited content to disk. */
  save(): Promise<void>;
  /** Writable → read-only, discarding edits. */
  cancel(): void;
  /** Dismiss the preview/editor entirely. */
  dismiss(): void;
}

export interface FileViewerController {
  viewer: FileViewer;
  actions: FileViewerActions;
}

export function useFiles(project: Project): FileViewerController {
  const [tree, setTree] = useState<TreeState>(idleTree);
  const [previewState, setPreview] = useState<PreviewState>(noPreview);

  // The latest values, for callbacks that must read state without re-subscribing
  // to it (a folder toggle reads the current `expanded`; a save reads the editor).
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const previewRef = useRef(previewState);
  previewRef.current = previewState;

  // Stamps the newest preview request; an older response that lands late is dropped.
  const previewRequest = useRef(0);
  // Every in-flight directory fetch, aborted on unmount (the panel is keyed by project).
  const controllersRef = useRef(new Set<AbortController>());

  useEffect(() => {
    return () => {
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
    };
  }, []);

  /** Fetch one directory's listing and upsert it into the tree. */
  const loadDir = useCallback(
    (dirPath: string): void => {
      setTree((current) => withDir(current, dirPath, dirLoading()));
      const controller = new AbortController();
      controllersRef.current.add(controller);
      fetchEntries(project.id, dirPath, controller.signal).then(
        (entries) => {
          controllersRef.current.delete(controller);
          setTree((current) => withDir(current, dirPath, dirReady(entries)));
        },
        (error: unknown) => {
          controllersRef.current.delete(controller);
          if (!controller.signal.aborted) setTree((current) => withDir(current, dirPath, dirError(messageOf(error))));
        },
      );
    },
    [project.id],
  );

  // The root fetch: the drawer's life-cycle, keyed on the project (a switch
  // remounts a fresh drawer, so this runs once per project).
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(noPreview);
    setTree(treeLoading());
    const controller = new AbortController();
    controllersRef.current.add(controller);
    fetchEntries(project.id, '', controller.signal).then(
      (entries) => {
        controllersRef.current.delete(controller);
        setTree(treeReady(entries));
      },
      (error: unknown) => {
        controllersRef.current.delete(controller);
        if (!controller.signal.aborted) setTree(treeError(messageOf(error)));
      },
    );
  }, [project.id]);

  const toggle = useCallback(
    (path: string): void => {
      const current = treeRef.current;
      const willExpand = !(current.status === 'ready' && current.expanded[path] === true);
      setTree((t) => withActive(withExpanded(t, path, willExpand), path));
      // Lazy-load on first expand; a collapse + re-expand reuses the cached listing.
      if (willExpand && !(current.status === 'ready' && path in current.dirs)) void loadDir(path);
    },
    [loadDir],
  );

  const refresh = useCallback((): void => {
    void loadDir('');
    const current = treeRef.current;
    if (current.status === 'ready') {
      for (const path of Object.keys(current.expanded)) if (path !== '') void loadDir(path);
    }
  }, [loadDir]);

  const preview = useCallback(
    (path: string): void => {
      const token = (previewRequest.current += 1);
      setPreview(previewLoading(baseName(path), path));
      fetchContent(project.id, path).then(
        (content) => {
          if (previewRequest.current === token) setPreview(previewOf(baseName(path), path, content));
        },
        (error: unknown) => {
          if (previewRequest.current === token) setPreview(previewError(baseName(path), path, messageOf(error)));
        },
      );
    },
    [project.id],
  );

  /**
   * One place every mutation goes through. Success re-lists the affected
   * directory so the tree reflects what just changed; a failure *rejects* so
   * the panel can keep its dialog open and show the server's message.
   */
  const runMutation = useCallback(
    async (operation: () => Promise<void>, affectedDir: string): Promise<void> => {
      await operation();
      void loadDir(affectedDir);
    },
    [loadDir],
  );

  /** The folder create/upload land in — the last folder clicked, default root. */
  const activeDir = useCallback((): string => {
    const current = treeRef.current;
    return current.status === 'ready' ? current.active : '';
  }, []);

  const create = useCallback(
    async (kind: 'file' | 'directory', name: string): Promise<void> => {
      const dir = activeDir();
      await runMutation(() => createEntry(project.id, joinPath(dir, name), kind), dir);
      // The new entry must be visible: keep its folder expanded.
      if (dir !== '') setTree((t) => withExpanded(t, dir, true));
    },
    [project.id, runMutation, activeDir],
  );

  const upload = useCallback(
    async (file: File): Promise<void> => {
      const dir = activeDir();
      await runMutation(() => uploadEntry(project.id, joinPath(dir, file.name), file), dir);
      if (dir !== '') setTree((t) => withExpanded(t, dir, true));
    },
    [project.id, runMutation, activeDir],
  );

  const rename = useCallback(
    async (path: string, to: string): Promise<void> => {
      await runMutation(() => renameEntry(project.id, path, to), parentPath(path));
      // A rename invalidates a preview of the renamed path.
      if (previewPath(previewRef.current) === path) setPreview(noPreview);
    },
    [project.id, runMutation],
  );

  const remove = useCallback(
    async (path: string): Promise<void> => {
      await runMutation(() => removeEntry(project.id, path), parentPath(path));
      // A delete invalidates a preview of the removed entry (or anything under it).
      const previewed = previewPath(previewRef.current);
      if (previewed !== null && (previewed === path || previewed.startsWith(`${path}/`))) setPreview(noPreview);
    },
    [project.id, runMutation],
  );

  const edit = useCallback((): void => {
    setPreview((current) => beginEdit(current));
  }, []);

  const editValue = useCallback((value: string): void => {
    setPreview((current) => updateEdit(current, value));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    const current = previewRef.current;
    if (current.kind !== 'editing' || current.saving) return;
    setPreview((p) => savingEdit(p));
    try {
      await saveContent(project.id, current.path, current.value);
      setPreview((p) => savedEdit(p, current.value));
    } catch (error: unknown) {
      setPreview((p) => saveFailedEdit(p, messageOf(error)));
    }
  }, [project.id]);

  const cancel = useCallback((): void => {
    setPreview((current) => cancelEdit(current));
  }, []);

  const dismiss = useCallback((): void => {
    setPreview(noPreview);
  }, []);

  const viewer = viewerOf(tree, previewState);

  return {
    viewer,
    actions: { toggle, preview, refresh, create, rename, remove, upload, edit, editValue, save, cancel, dismiss },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
