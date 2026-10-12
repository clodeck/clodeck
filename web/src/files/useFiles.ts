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
import { exceedsUploadCap, OVER_LIMIT_REASON, type UploadOutcome } from './upload';

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
  /**
   * Show a folder: make it the active one and load its listing, leaving it
   * expanded rather than toggling it. The flat list's folder rows use this, and
   * so does its breadcrumb — neither has an "expanded" state to flip, and a
   * folder that was already open must not close on the click that enters it.
   */
  openDir(path: string): void;
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
  /**
   * Upload a batch into the active folder. The requests are independent — one
   * bad file does not abort the rest — and the affected directory re-lists
   * **once** for the whole batch, so a partial failure leaves the listing in its
   * real state rather than an error state. A file over the cap never becomes a
   * request: it settles as a failure here. It therefore never *rejects* — it
   * resolves with one outcome per file, which is what the panel's single summary
   * is built from.
   */
  upload(files: readonly File[]): Promise<UploadOutcome[]>;
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

  /** Fetch a folder's listing unless it is already loaded (a re-expand reuses it). */
  const ensureLoaded = useCallback(
    (path: string): void => {
      const current = treeRef.current;
      if (current.status === 'ready' && path in current.dirs) return;
      void loadDir(path);
    },
    [loadDir],
  );

  const toggle = useCallback(
    (path: string): void => {
      const willExpand = !(treeRef.current.status === 'ready' && treeRef.current.expanded[path] === true);
      setTree((t) => withActive(withExpanded(t, path, willExpand), path));
      if (willExpand) ensureLoaded(path);
    },
    [ensureLoaded],
  );

  const openDir = useCallback(
    (path: string): void => {
      setTree((t) => withActive(withExpanded(t, path, true), path));
      ensureLoaded(path);
    },
    [ensureLoaded],
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
   * One place the mutations that *reject* go through — rename and delete, where
   * the panel keeps its dialog open and shows the server's message. Success
   * re-lists the affected directory so the tree reflects what just changed; no
   * folder is forced open, because neither of these lands in one. Create and
   * upload settle through {@link settle} instead, since both do.
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

  /**
   * What a mutation does to the folder it landed in: re-list it, and leave it
   * open. Without the second half a file created in a collapsed folder would
   * land invisibly; the root is never collapsed, so it has nothing to expand.
   */
  const settle = useCallback(
    (dir: string): void => {
      void loadDir(dir);
      if (dir !== '') setTree((t) => withExpanded(t, dir, true));
    },
    [loadDir],
  );

  const create = useCallback(
    async (kind: 'file' | 'directory', name: string): Promise<void> => {
      const dir = activeDir();
      await createEntry(project.id, joinPath(dir, name), kind);
      settle(dir);
    },
    [project.id, settle, activeDir],
  );

  const upload = useCallback(
    async (files: readonly File[]): Promise<UploadOutcome[]> => {
      // An empty drop is not a batch: nothing to send, nothing to re-list.
      if (files.length === 0) return [];
      const dir = activeDir();
      // Independent on purpose: each file's outcome is its own, so two that fail
      // do not stop the third that would have worked. An oversize file is
      // refused here rather than by the server's 413 — same cap, no round trip.
      const outcomes = await Promise.all(
        files.map(async (file): Promise<UploadOutcome> => {
          if (exceedsUploadCap(file.size)) return { ok: false, name: file.name, reason: OVER_LIMIT_REASON };
          try {
            await uploadEntry(project.id, joinPath(dir, file.name), file);
            return { ok: true, name: file.name };
          } catch (error: unknown) {
            return { ok: false, name: file.name, reason: messageOf(error) };
          }
        }),
      );

      settle(dir);
      return outcomes;
    },
    [project.id, settle, activeDir],
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
    actions: { toggle, openDir, preview, refresh, create, rename, remove, upload, edit, editValue, save, cancel, dismiss },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
