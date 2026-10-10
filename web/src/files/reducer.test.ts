import type { FileContent, FileEntry } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import {
  baseName,
  breadcrumb,
  idleListing,
  isValidName,
  joinPath,
  listingError,
  listingLoading,
  listingReady,
  noPreview,
  parentPath,
  previewLoading,
  previewOf,
  sortEntries,
  viewerOf,
  viewerPath,
} from './reducer';

/**
 * The reducer is the seam that can be tested without a DOM. Every expected value
 * below is read off the spec's pinned shapes (spec-04 §"Web client") and the
 * server's listing rules (§"The reader") — not by re-running the implementation.
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

  it('builds breadcrumb segments with cumulative paths', () => {
    expect(breadcrumb('')).toEqual([]);
    expect(breadcrumb('src')).toEqual([{ name: 'src', path: 'src' }]);
    expect(breadcrumb('src/ui')).toEqual([
      { name: 'src', path: 'src' },
      { name: 'ui', path: 'src/ui' },
    ]);
  });

  it('accepts a plain name and refuses anything that is not a single clean segment', () => {
    expect(isValidName('notes.txt')).toBe(true);
    expect(isValidName('.gitignore')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\0b']) {
      expect(isValidName(bad)).toBe(false);
    }
  });
});

describe('listing transitions', () => {
  it('starts idle', () => {
    expect(idleListing()).toEqual({ status: 'idle' });
  });

  it('goes to loading with the path being listed', () => {
    expect(listingLoading('src')).toEqual({ status: 'loading', path: 'src' });
  });

  it('goes to ready with the entries sorted', () => {
    expect(listingReady('', [FILE, DIR])).toEqual({
      status: 'ready',
      path: '',
      entries: [DIR, FILE],
    });
  });

  it('goes to error with the message', () => {
    expect(listingError('src', '404 Not Found')).toEqual({
      status: 'error',
      path: 'src',
      message: '404 Not Found',
    });
  });
});

describe('viewerOf', () => {
  it('folds the listing and the preview into the pinned FileViewer arms', () => {
    expect(viewerOf(idleListing(), noPreview)).toEqual({ status: 'idle' });
    expect(viewerOf(listingLoading('src'), noPreview)).toEqual({ status: 'loading', path: 'src' });
    expect(viewerOf(listingReady('src', [FILE]), noPreview)).toEqual({
      status: 'ready',
      path: 'src',
      entries: [FILE],
      preview: { kind: 'none' },
    });
    expect(viewerOf(listingError('src', 'boom'), noPreview)).toEqual({
      status: 'error',
      path: 'src',
      message: 'boom',
    });
  });

  it('carries the preview into the ready arm', () => {
    const preview = previewLoading('app.ts');
    expect(viewerOf(listingReady('src', [FILE]), preview)).toEqual({
      status: 'ready',
      path: 'src',
      entries: [FILE],
      preview,
    });
  });
});

describe('viewerPath', () => {
  it('reports the current directory for every arm that names one, else the root', () => {
    expect(viewerPath({ status: 'idle' })).toBe('');
    expect(viewerPath({ status: 'loading', path: 'src' })).toBe('src');
    expect(viewerPath({ status: 'ready', path: '', entries: [], preview: noPreview })).toBe('');
    expect(viewerPath({ status: 'error', path: 'src/ui', message: 'x' })).toBe('src/ui');
  });
});

describe('preview transitions', () => {
  it('maps a text file to the text arm, keeping the truncation flag', () => {
    const content: FileContent = { kind: 'text', content: 'hello', truncated: true, size: 999 };
    expect(previewOf('app.ts', content)).toEqual({ kind: 'text', name: 'app.ts', content: 'hello', truncated: true });
  });

  it('maps a binary file to the binary arm with only its size', () => {
    const content: FileContent = { kind: 'binary', size: 4096 };
    expect(previewOf('logo.png', content)).toEqual({ kind: 'binary', name: 'logo.png', size: 4096 });
  });

  it('has a none arm and a loading arm carrying the file name', () => {
    expect(noPreview).toEqual({ kind: 'none' });
    expect(previewLoading('app.ts')).toEqual({ kind: 'loading', name: 'app.ts' });
  });
});
