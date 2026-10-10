import type { Dirent } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FileContent, FileEntry } from '@clodeck/shared';

/**
 * The root-scoped filesystem access (spec-04 §"The type fence"): the only thing
 * that reads — and, next ticket, writes — a project's files. It is constructed
 * with the canonical project path `resolveProject` already returned, so the root
 * is trusted; every path that arrives *from the wire* is re-validated through
 * the same realpath-containment rule the allowlist uses before it becomes a
 * `ScopedPath`.
 *
 * There is no facade over `fs` (unlike the SDK / node-pty): `fs` is not a native
 * binary, so the reader is tested against real temp directories exactly like
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

export type ResolveResult =
  | { status: 'ok'; scoped: ScopedPath; kind: 'file' | 'directory' }
  | { status: 'not_found' }
  | { status: 'outside_root' };

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
}

/** How many bytes of a text file the preview reads; larger is truncated (spec-04). */
const MAX_TEXT_BYTES = 256 * 1024;

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

  return { resolve, listDir, readFile };
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
