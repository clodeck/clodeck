import type { FileContent, FileEntry } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import {
  baseName,
  beginEdit,
  cancelEdit,
  dirError,
  dirLoading,
  dirReady,
  idleTree,
  isValidName,
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
  sortEntries,
  treeError,
  treeLoading,
  treeReady,
  updateEdit,
  viewerOf,
  withActive,
  withDir,
  withExpanded,
  type TreeState,
} from './reducer';

/**
 * The reducer is the seam that can be tested without a DOM. Every expected value
 * below is read off the pinned shapes — the tree (a keyed map of directories plus
 * the expanded set and the active folder) and the preview/editor union — not by
 * re-running the implementation.
 */

const FILE: FileEntry = { type: 'file', name: 'README.md', size: 12, mtime: '2026-01-01T00:00:00.000Z' };
const DIR: FileEntry = { type: 'directory', name: 'src' };
const LINK: FileEntry = { type: 'symlink', name: 'escape' };

describe('sortEntries', () => {
  it('puts directories before files, each group by name ascending', () => {
    const input: FileEntry[] = [
      { type: 'file', name: 'zeta.ts', size: 1, mtime: '2026-01-01T00:00:00.000Z' },
      { type: 'directory', name: 'zdir' },
      { type: 'file', name: 'alpha.ts', size: 1, mtime: '2026-01-01T00:00:00.000Z' },
      { type: 'directory', name: 'adir' },
    ];

    expect(sortEntries(input).map((entry) => entry.name)).toEqual(['adir', 'zdir', 'alpha.ts', 'zeta.ts']);
  });

  it('sorts escaping symlinks in with the files, and leaves the input untouched', () => {
    const input: FileEntry[] = [LINK, FILE, DIR];

    expect(sortEntries(input).map((entry) => entry.name)).toEqual(['src', 'README.md', 'escape']);
    expect(input.map((entry) => entry.name)).toEqual(['escape', 'README.md', 'src']);
  });
});

describe('path handling', () => {
  it('joins a directory and a name, with the root as the empty string', () => {
    expect(joinPath('', 'src')).toBe('src');
    expect(joinPath('src', 'app.ts')).toBe('src/app.ts');
    expect(joinPath('src/ui', 'button.tsx')).toBe('src/ui/button.tsx');
  });

  it('walks up one level, stopping at the root', () => {
    expect(parentPath('')).toBe('');
    expect(parentPath('src')).toBe('');
    expect(parentPath('src/app.ts')).toBe('src');
    expect(parentPath('src/ui/button.tsx')).toBe('src/ui');
  });

  it('reads the last segment as the base name', () => {
    expect(baseName('')).toBe('');
    expect(baseName('src')).toBe('src');
    expect(baseName('src/app.ts')).toBe('app.ts');
  });

  it('accepts a plain name and refuses anything that is not a single clean segment', () => {
    expect(isValidName('notes.txt')).toBe(true);
    expect(isValidName('.gitignore')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\0b']) {
      expect(isValidName(bad)).toBe(false);
    }
  });
});

describe('tree transitions', () => {
  it('starts idle, then loading, then ready with a sorted root and no expansion', () => {
    expect(idleTree()).toEqual({ status: 'idle' });
    expect(treeLoading()).toEqual({ status: 'loading' });
    expect(treeReady([FILE, DIR])).toEqual({
      status: 'ready',
      dirs: { '': { status: 'ready', entries: [DIR, FILE] } },
      expanded: {},
      active: '',
    });
  });

  it('goes to error with the message', () => {
    expect(treeError('404 Not Found')).toEqual({ status: 'error', message: '404 Not Found' });
  });

  it('builds a loading, ready and error listing for one directory', () => {
    expect(dirLoading()).toEqual({ status: 'loading' });
    expect(dirReady([FILE, DIR])).toEqual({ status: 'ready', entries: [DIR, FILE] });
    expect(dirError('boom')).toEqual({ status: 'error', message: 'boom' });
  });
});

describe('tree operations', () => {
  const ready = (): TreeState => treeReady([DIR, FILE]);

  it('upserts one directory listing without touching the others', () => {
    const tree = withDir(ready(), 'src', dirReady([FILE]));
    expect(tree.status).toBe('ready');
    if (tree.status !== 'ready') return;
    expect(tree.dirs['']).toEqual({ status: 'ready', entries: [DIR, FILE] });
    expect(tree.dirs['src']).toEqual({ status: 'ready', entries: [FILE] });
  });

  it('expands and collapses a directory immutably', () => {
    const expanded = withExpanded(ready(), 'src', true);
    expect(expanded.status === 'ready' && expanded.expanded['src']).toBe(true);
    const collapsed = withExpanded(expanded, 'src', false);
    expect(collapsed.status === 'ready' && collapsed.expanded['src']).toBeUndefined();
  });

  it('selects the active folder for create/upload', () => {
    const tree = withActive(ready(), 'src');
    expect(tree.status === 'ready' && tree.active).toBe('src');
  });
});

describe('viewerOf', () => {
  it('folds the tree and the preview into the pinned FileViewer arms', () => {
    expect(viewerOf(idleTree(), noPreview)).toEqual({ status: 'idle' });
    expect(viewerOf(treeLoading(), noPreview)).toEqual({ status: 'loading' });
    expect(viewerOf(treeError('boom'), noPreview)).toEqual({ status: 'error', message: 'boom' });
  });

  it('carries the preview into the ready arm', () => {
    const preview = previewLoading('app.ts', 'src/app.ts');
    expect(viewerOf(treeReady([FILE]), preview)).toEqual({
      status: 'ready',
      dirs: { '': { status: 'ready', entries: [FILE] } },
      expanded: {},
      active: '',
      preview,
    });
  });
});

describe('preview transitions', () => {
  it('maps a text file to the text arm with its path and truncation flag', () => {
    const content: FileContent = { kind: 'text', content: 'hello', truncated: true, size: 999 };
    expect(previewOf('app.ts', 'src/app.ts', content)).toEqual({
      kind: 'text',
      name: 'app.ts',
      path: 'src/app.ts',
      content: 'hello',
      truncated: true,
    });
  });

  it('maps a binary file to the binary arm with its path and size', () => {
    const content: FileContent = { kind: 'binary', size: 4096 };
    expect(previewOf('logo.png', 'assets/logo.png', content)).toEqual({
      kind: 'binary',
      name: 'logo.png',
      path: 'assets/logo.png',
      size: 4096,
    });
  });

  it('has a none arm, a loading arm carrying name + path, and an error arm', () => {
    expect(noPreview).toEqual({ kind: 'none' });
    expect(previewLoading('app.ts', 'src/app.ts')).toEqual({ kind: 'loading', name: 'app.ts', path: 'src/app.ts' });
    expect(previewError('app.ts', 'src/app.ts', 'boom')).toEqual({ kind: 'error', name: 'app.ts', path: 'src/app.ts', message: 'boom' });
  });

  it('reports the path a preview is showing, or null for the empty pane', () => {
    expect(previewPath(noPreview)).toBeNull();
    expect(previewPath(previewLoading('a.txt', 'a.txt'))).toBe('a.txt');
    expect(previewPath({ kind: 'text', name: 'a.txt', path: 'a.txt', content: 'x', truncated: false })).toBe('a.txt');
  });
});

describe('editing transitions', () => {
  const text = (): { kind: 'text'; name: string; path: string; content: string; truncated: boolean } => ({
    kind: 'text',
    name: 'a.txt',
    path: 'a.txt',
    content: 'hello',
    truncated: false,
  });

  const editing = (): {
    kind: 'editing';
    name: string;
    path: string;
    original: string;
    value: string;
    dirty: boolean;
    saving: boolean;
    error: string | null;
  } => ({
    kind: 'editing',
    name: 'a.txt',
    path: 'a.txt',
    original: 'hello',
    value: 'hello',
    dirty: false,
    saving: false,
    error: null,
  });

  it('seeds the editor with the current content and a clean state', () => {
    expect(beginEdit(text())).toEqual(editing());
  });

  it('stays read-only for a truncated file (editing would clobber the rest)', () => {
    expect(beginEdit({ ...text(), truncated: true })).toEqual({ ...text(), truncated: true });
  });

  it('tracks keystrokes as dirty against the original, and clears a stale error', () => {
    expect(updateEdit(editing(), 'hello')).toEqual(editing());
    expect(updateEdit({ ...editing(), error: 'old' }, 'changed')).toEqual({ ...editing(), value: 'changed', dirty: true, error: null });
  });

  it('flags the save in flight and lands it back on the text arm', () => {
    const dirty = { ...editing(), value: 'changed', dirty: true };
    expect(savingEdit(dirty)).toEqual({ ...dirty, saving: true, error: null });
    expect(savedEdit(dirty, 'changed')).toEqual({ kind: 'text', name: 'a.txt', path: 'a.txt', content: 'changed', truncated: false });
  });

  it('keeps the buffer on a failed save and surfaces the message', () => {
    const dirty = { ...editing(), value: 'changed', dirty: true };
    expect(saveFailedEdit(dirty, 'boom')).toEqual({ ...dirty, saving: false, error: 'boom' });
  });

  it('cancel restores the original content on the text arm', () => {
    const dirty = { ...editing(), value: 'changed', dirty: true };
    expect(cancelEdit(dirty)).toEqual({ kind: 'text', name: 'a.txt', path: 'a.txt', content: 'hello', truncated: false });
  });
});
