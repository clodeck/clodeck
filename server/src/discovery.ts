import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';

import { createAllowlist, type Allowlist } from './allowlist.js';

/**
 * The discovery seam (wayfinder 05 §7): one interface, so a later multi-user
 * slice can parameterize it with an actor instead of rewriting it — and so
 * nothing else in the server reads the projects root directly.
 */
export interface ProjectDiscovery {
  listProjects(): Promise<Project[]>;
}

export interface DiscoveryOptions {
  /** Where a misconfigured or unreadable root is reported (never a 500). */
  warn?: (message: string) => void;
  /** Defaults to the policy over `root`; injected in tests. */
  allowlist?: Allowlist;
}

/** A project's id is the reversible `base64url` of its canonical path — no lookup table (05 §3). */
export function toProjectId(canonicalPath: string): string {
  return Buffer.from(canonicalPath, 'utf8').toString('base64url');
}

export function createProjectDiscovery(
  root: string | null,
  options: DiscoveryOptions = {},
): ProjectDiscovery {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const allowlist = root === null ? null : (options.allowlist ?? createAllowlist(root));

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

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        // Plain files are skipped; a symlink is allowed through to the allowlist,
        // which decides by where it actually resolves.
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const canonical = await allowlist.canonicalizeInsideRoot(path.join(root, entry.name));
        if (canonical === null) continue;
        // The allowlist resolves symlinks, so this also rejects a link to a file.
        if (!(await isDirectory(canonical))) continue;

        projects.push({ id: toProjectId(canonical), name: entry.name, path: canonical });
      }

      return projects.sort((left, right) => left.name.localeCompare(right.name));
    },
  };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
