import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';

import { createAllowlist } from './allowlist.js';
import { warnToConsole, type Warn } from './logging.js';

/**
 * The discovery seam (wayfinder 05 §7): one interface, so a later multi-user
 * slice can parameterize it with an actor instead of rewriting it — and so
 * nothing else in the server reads the projects root directly.
 */
export interface ProjectDiscovery {
  listProjects(): Promise<Project[]>;
  /**
   * Decode the id, re-validate through the allowlist, and require a directory.
   * Null otherwise. Decoding an id is never authorization (wayfinder 05 §5), so
   * every caller re-enters through this door rather than trusting the decode.
   */
  resolveProject(id: string): Promise<Project | null>;
}

export interface DiscoveryOptions {
  /** Where a misconfigured or unreadable root is reported (never a 500). */
  warn?: Warn;
}

/** A project's id is the reversible `base64url` of its canonical path — no lookup table (05 §3). */
function toProjectId(canonicalPath: string): string {
  return Buffer.from(canonicalPath, 'utf8').toString('base64url');
}

/**
 * The inverse of `toProjectId`, for a string that arrived over the wire. The
 * charset is checked first because `Buffer.from(…, 'base64url')` happily decodes
 * arbitrary input into bytes, and those bytes should never become a path.
 */
function decodeProjectId(id: string): string | null {
  if (id === '' || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return Buffer.from(id, 'base64url').toString('utf8');
}

export function createProjectDiscovery(
  root: string | null,
  options: DiscoveryOptions = {},
): ProjectDiscovery {
  const warn = options.warn ?? warnToConsole;
  const allowlist = root === null ? null : createAllowlist(root);

  if (root === null) {
    warn('no projects root configured — set PROJECTS_ROOT or projectsRoot in clodeck.config.json');
  }

  return {
    /** Re-scans on every call: a single root is cheap, so there is nothing to invalidate (05 §4). */
    async listProjects(): Promise<Project[]> {
      if (root === null || allowlist === null) {
        return [];
      }

      let entries: Dirent[];
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        // A missing, unreadable or non-directory root is an empty list, never a 500 (05 §6).
        warn(`could not read projects root ${root}: ${String(error)}`);
        return [];
      }

      const projects: Project[] = [];
      // A project's id *is* its canonical path, so a directory must be listed
      // exactly once: a symlink pointing at a sibling would otherwise produce a
      // second row with the same id (and the same path) under a different name.
      const claimed = new Set<string>();

      for (const entry of [...entries].sort(compareEntries)) {
        if (entry.name.startsWith('.')) continue;
        // Plain files are skipped; a symlink is allowed through to the allowlist,
        // which decides by where it actually resolves.
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const canonical = await allowlist.canonicalizeInsideRoot(path.join(root, entry.name));
        if (canonical === null) continue;
        // The allowlist resolves symlinks, so this also rejects a link to a file.
        if (!(await isDirectory(canonical))) continue;
        if (claimed.has(canonical)) continue;

        claimed.add(canonical);
        projects.push({ id: toProjectId(canonical), name: entry.name, path: canonical });
      }

      return projects.sort((left, right) => left.name.localeCompare(right.name));
    },

    /**
     * The id is client-supplied, so the decode only produces a *candidate*: the
     * allowlist still has to accept it and it still has to be a directory. A
     * non-allowlisted id therefore resolves to null exactly like a well-formed
     * one pointing at nothing.
     */
    async resolveProject(id: string): Promise<Project | null> {
      if (root === null || allowlist === null) return null;

      const requested = decodeProjectId(id);
      if (requested === null) return null;

      const canonical = await allowlist.canonicalizeInsideRoot(requested);
      if (canonical === null) return null;

      if (!(await isDirectory(canonical))) return null;

      return { id: toProjectId(canonical), name: path.basename(canonical), path: canonical };
    },
  };
}

/**
 * Real directories before symlinks, by name within each group — so a directory
 * keeps its own name when an alias resolves to it, and the outcome never depends
 * on `readdir` order.
 */
function compareEntries(left: Dirent, right: Dirent): number {
  return (
    Number(left.isSymbolicLink()) - Number(right.isSymbolicLink()) ||
    left.name.localeCompare(right.name)
  );
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
