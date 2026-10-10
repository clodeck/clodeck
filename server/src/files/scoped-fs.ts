import type { Dirent, Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename as renameFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { FileContent, FileEntry } from '@clodeck/shared';

/**
 * The root-scoped filesystem access (spec-04 §"The type fence"): the only thing
 * that reads and writes a project's files. It is constructed with the canonical
 * project path `resolveProject` already returned, so the root is trusted; every
 * path that arrives *from the wire* is re-validated through the same
 * realpath-containment rule the allowlist uses before it becomes a `ScopedPath`.
 *
 * There is no facade over `fs` (unlike the SDK / node-pty): `fs` is not a native
 * binary, so the module is tested against real temp directories exactly like
 * `discovery.test.ts`.
 */

declare const scoped: unique symbol;
/**
 * A path that has canonicalized inside the project root. The only way to make
 * one is `resolve`, so a read function that takes this cannot be handed an
 * arbitrary string — the compiler rejects it. The brand is compile-time only:
 * bytes that arrive over the wire are still re-validated at runtime.
 */
export type ScopedPath = string & { readonly [scoped]: 'inside-root' };

declare const filename: unique symbol;
/**
 * A single clean path segment — no `/` or `\`, no `.`/`..`, no NUL, not empty,
 * length-capped. The only way to make one is `name()`, so a write function that
 * takes this cannot be handed a name that traverses. Compile-time only, like
 * `ScopedPath`.
 */
export type FileName = string & { readonly [filename]: 'single-segment' };

export type ResolveResult =
  | { status: 'ok'; scoped: ScopedPath; kind: 'file' | 'directory' }
  | { status: 'not_found' }
  | { status: 'outside_root' };

/** Where a write lands: an already-resolved parent directory plus one clean name. */
export interface WriteTarget {
  parent: ScopedPath;
  name: FileName;
}

export type WriteTargetResult =
  | { status: 'ok'; target: WriteTarget }
  | { status: 'is_root' } // empty rel — the project root itself
  | { status: 'not_found' } // parent missing
  | { status: 'outside_root' } // parent escapes
  | { status: 'not_a_directory' } // parent is a file
  | { status: 'invalid_name' }; // basename not a single clean segment

export type WriteResult =
  | { status: 'ok' }
  | { status: 'exists' } // create onto an existing name
  | { status: 'not_found' } // rename/remove a missing name
  | { status: 'symlink' }; // create through a symlink in the final segment

export interface ScopedFs {
  /**
   * Validate a client-supplied relative path against the project root and mint
   * the only `ScopedPath` there is. `resolve` is the one door: it realpath's the
   * joined path, confirms containment, and stats the result — so a `ScopedPath`
   * is proof the path is inside the root and known to be a file or directory.
   */
  resolve(rel: string): Promise<ResolveResult>;
  /** List one directory (already resolved). */
  listDir(dir: ScopedPath): Promise<FileEntry[]>;
  /** Read one file (already resolved), capped and binary-aware. */
  readFile(file: ScopedPath): Promise<FileContent>;
  /**
   * Validate a client-supplied relative path as a *write target* and mint the
   * only `WriteTarget` there is. `resolveWriteTarget` is the write door: it
   * realpath's the parent directory (so the parent is a real, in-root directory
   * with no symlink anywhere in it) and runs the basename through `name()` — so
   * a `WriteTarget` is proof its parent is inside the root and its name is a
   * single clean segment. The empty path is the root itself, which is never a
   * valid target.
   */
  resolveWriteTarget(rel: string): Promise<WriteTargetResult>;
  /** Create a new file (never overwrites, never follows a final-segment symlink). */
  createFile(target: WriteTarget, content: Buffer): Promise<WriteResult>;
  /** Create a new directory (never over an existing entry, never through a symlink). */
  createDirectory(target: WriteTarget): Promise<WriteResult>;
  /** Rename the target entry within its own directory (the entry itself, never a symlink's target). */
  rename(target: WriteTarget, newName: FileName): Promise<WriteResult>;
  /** Remove the target entry (a symlink is removed as the link, never followed). */
  remove(target: WriteTarget): Promise<WriteResult>;
}

/** The largest single segment we mint; the host fs caps names at 255 bytes. */
const MAX_NAME_BYTES = 255;

/** How many bytes of a text file the preview reads; larger is truncated (spec-04). */
const MAX_TEXT_BYTES = 256 * 1024;

/**
 * Validate a single path segment and mint the only `FileName` there is. Returns
 * `null` for anything that is not a plain name: empty, `.`/`..`, a separator, a
 * NUL, or a segment longer than the host fs allows. This is the write half's
 * compile-time fence — a route-level `name(to)` refusal *and* the basename check
 * inside `resolveWriteTarget` — but, like `resolve`, it is re-run on the wire
 * string at runtime, not relied on for safety.
 */
export function name(input: string): FileName | null {
  if (input === '' || input === '.' || input === '..') return null;
  if (input.includes('/') || input.includes('\\') || input.includes('\0')) return null;
  if (Buffer.byteLength(input, 'utf8') > MAX_NAME_BYTES) return null;
  return input as FileName;
}

export function createScopedFs(projectPath: string): ScopedFs {
  const root = projectPath;

  async function resolve(rel: string): Promise<ResolveResult> {
    const candidate = path.join(root, rel);
    const canonical = await realpathOrNull(candidate);
    if (canonical === null) return { status: 'not_found' };
    if (!isInsideRoot(root, canonical)) return { status: 'outside_root' };

    const kind = await kindOf(canonical);
    if (kind === null) return { status: 'not_found' };

    return { status: 'ok', scoped: canonical as ScopedPath, kind };
  }

  async function listDir(dir: ScopedPath): Promise<FileEntry[]> {
    const dirents = await readdir(dir, { withFileTypes: true });
    const entries: FileEntry[] = [];
    for (const dirent of dirents) {
      const entry = await toEntry(root, dir, dirent);
      if (entry !== null) entries.push(entry);
    }
    return entries.sort(compareEntries);
  }

  async function readFile(file: ScopedPath): Promise<FileContent> {
    const info = await stat(file);
    const handle = await open(file, 'r');
    try {
      const length = Math.min(info.size, MAX_TEXT_BYTES);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return classify(buffer.subarray(0, bytesRead), info.size);
    } finally {
      await handle.close();
    }
  }

  async function resolveWriteTarget(rel: string): Promise<WriteTargetResult> {
    if (rel === '') return { status: 'is_root' };

    const parent = await resolve(path.dirname(rel));
    if (parent.status === 'not_found') return { status: 'not_found' };
    if (parent.status === 'outside_root') return { status: 'outside_root' };
    if (parent.kind !== 'directory') return { status: 'not_a_directory' };

    const base = name(path.basename(rel));
    if (base === null) return { status: 'invalid_name' };

    return { status: 'ok', target: { parent: parent.scoped, name: base } };
  }

  async function createFile(target: WriteTarget, content: Buffer): Promise<WriteResult> {
    const full = path.join(target.parent, target.name);
    const existing = await lstatOrNull(full);
    if (existing !== null) return existing.isSymbolicLink() ? { status: 'symlink' } : { status: 'exists' };

    try {
      // `wx` is `O_CREAT | O_EXCL`: no overwrite, and no follow of a symlink that
      // appears in the window between the `lstat` and the write.
      await writeFile(full, content, { flag: 'wx' });
      return { status: 'ok' };
    } catch (error) {
      if (isEexist(error)) return { status: 'exists' };
      throw error;
    }
  }

  async function createDirectory(target: WriteTarget): Promise<WriteResult> {
    const full = path.join(target.parent, target.name);
    const existing = await lstatOrNull(full);
    if (existing !== null) return existing.isSymbolicLink() ? { status: 'symlink' } : { status: 'exists' };

    try {
      // Non-recursive `mkdir` is the directory twin of `wx`: it fails with
      // EEXIST rather than writing over whatever is already there.
      await mkdir(full);
      return { status: 'ok' };
    } catch (error) {
      if (isEexist(error)) return { status: 'exists' };
      throw error;
    }
  }

  async function rename(target: WriteTarget, newName: FileName): Promise<WriteResult> {
    const from = path.join(target.parent, target.name);
    const existing = await lstatOrNull(from);
    if (existing === null) return { status: 'not_found' };

    // `parent` is realpath'd (no symlink anywhere in it), and `rename(2)` does
    // not follow a symlink in the destination's final segment — so a rename is
    // safe. Renaming a symlink *entry* renames the link, never its target.
    await renameFile(from, path.join(target.parent, newName));
    return { status: 'ok' };
  }

  async function remove(target: WriteTarget): Promise<WriteResult> {
    const full = path.join(target.parent, target.name);
    const existing = await lstatOrNull(full);
    if (existing === null) return { status: 'not_found' };

    // `rm` on a symlink removes the link itself, never its target; `recursive`
    // is only set for a real directory (a dir *symlink* is unlinked as a link).
    await rm(full, { recursive: existing.isDirectory(), force: true });
    return { status: 'ok' };
  }

  return { resolve, listDir, readFile, resolveWriteTarget, createFile, createDirectory, rename, remove };
}

/**
 * One `Dirent` → one `FileEntry`. A symlink is resolved against the *root* (not
 * its own directory), so a link to a sibling inside the project is still
 * followed; only a link that escapes the root (or is broken) becomes the
 * non-navigable `symlink` arm. A `symlink` that resolves to a directory is
 * listed as a directory — the client can descend through it.
 */
async function toEntry(root: string, dir: ScopedPath, dirent: Dirent): Promise<FileEntry | null> {
  const name = dirent.name;
  const full = path.join(dir, name);

  if (dirent.isSymbolicLink()) {
    const resolved = await realpathOrNull(full);
    if (resolved === null || !isInsideRoot(root, resolved)) return { type: 'symlink', name };
    return statEntry(name, resolved);
  }

  if (dirent.isDirectory()) return { type: 'directory', name };
  if (dirent.isFile()) return statEntry(name, full);

  // Sockets, fifos, devices — not files or directories, and never listed.
  return null;
}

/** The `file`/`directory` arm for a path already known to be inside the root. */
async function statEntry(name: string, target: string): Promise<FileEntry | null> {
  const kind = await kindOf(target);
  if (kind === 'directory') return { type: 'directory', name };
  if (kind === 'file') {
    const info = await stat(target);
    return { type: 'file', name, size: info.size, mtime: info.mtime.toISOString() };
  }
  return null;
}

/** Text when the window is NUL-free and valid UTF-8; binary otherwise. */
function classify(buffer: Buffer, size: number): FileContent {
  if (buffer.indexOf(0) !== -1) return { kind: 'binary', size };
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { kind: 'text', content, truncated: size > MAX_TEXT_BYTES, size };
  } catch {
    return { kind: 'binary', size };
  }
}

/** Directories first, then files, then symlinks; by name within each group. */
function compareEntries(left: FileEntry, right: FileEntry): number {
  return rank(left) - rank(right) || left.name.localeCompare(right.name);
}

function rank(entry: FileEntry): number {
  return entry.type === 'directory' ? 0 : entry.type === 'file' ? 1 : 2;
}

/**
 * Containment by `path.relative` — the same rule `allowlist.ts` uses, inlined
 * here because the reader needs to *distinguish* "missing" from "outside" while
 * the allowlist folds both into `null`.
 */
function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

async function kindOf(target: string): Promise<'file' | 'directory' | null> {
  try {
    const info = await stat(target);
    return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : null;
  } catch {
    return null;
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

/** `lstat` without following the final segment — `null` when the entry is absent. */
async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await lstat(target);
  } catch {
    return null;
  }
}

/** The `O_EXCL`/non-recursive-create race loser: something is already at the name. */
function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}
