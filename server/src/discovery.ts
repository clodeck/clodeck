import type { Dirent, Stats } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Project } from '@clodeck/shared';

import { createAllowlist } from './allowlist.js';
// The drawer's `name()` — one clean segment — imported under the name this
// module reads it by, so the seam's own parameter can keep the interface's
// spelling without shadowing it.
import { name as cleanSegment } from './files/scoped-fs.js';
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
  /**
   * Create one project directory under the root and answer it (ticket 47).
   *
   * It lives here rather than on `ScopedFs` because it is the *root-level*
   * sibling of both: it reads and writes the projects root itself, which is
   * exactly what `ScopedFs` refuses to do by design (its own root is never a
   * valid write target). Discovery is the only module that touches the root, and
   * it stays that way.
   */
  createProject(name: string): Promise<CreateProjectResult>;
  /**
   * Delete one project directory from the root, recursively (ticket 89).
   *
   * It lives here for the same reason `createProject` does: it is a *root-level*
   * operation, and discovery is the only module that touches the root. `ScopedFs`
   * is not the seam for it — it is project-scoped by construction and its
   * `remove` would happily unlink a symlink, which is exactly the outcome a
   * project delete must refuse.
   *
   * An id is deletable only when exactly one entry of the root canonicalizes to
   * it *and* that entry is a real directory (`lstat`, not a symlink). Anything
   * else is refused: a link shown as a project would otherwise destroy the
   * target while the label named the link, and an alias would make the id
   * ambiguous (decision 87, D6). The root itself is not an immediate child, so
   * it is never a target.
   *
   * The busy checks — a live run, an attached terminal — are the route's, not
   * discovery's: they are process state, not facts about the root.
   */
  deleteProject(id: string): Promise<DeleteProjectResult>;
  /**
   * The canonical projects root, or null when none is configured — the same
   * directory the allowlist compares against, handed out for one reader: the
   * command list, which walks from a project *up* to the root and no further
   * (ticket 75).
   *
   * Every other read starts at a project `resolveProject` named; this one cannot,
   * because what it reads lives above it. The root is therefore the bound rather
   * than the subject: it is what stops the walk, and it is already the only
   * authorization boundary there is.
   */
  canonicalRoot(): Promise<string | null>;
}

/**
 * What a {@link ProjectDiscovery.createProject} came to. It is its own union
 * rather than a `WriteResult`: there is no symlink to refuse (nothing is written
 * *through* anything — an entry at the name is simply in the way) and no
 * existing-file arm (the name is new or it is not), and the two refusals it does
 * have are about the root and the name.
 */
export type CreateProjectResult =
  | { status: 'ok'; project: Project }
  | { status: 'invalid_name' } // not a single clean, non-dot segment
  | { status: 'exists' } // something is already at the name — never overwritten
  | { status: 'no_root' }; // unconfigured, absent, or not a directory at all

/**
 * What a {@link ProjectDiscovery.deleteProject} came to. `busy` is deliberately
 * absent: whether a run or a terminal holds the project is process state the
 * route checks first, and discovery neither knows nor asks.
 */
export type DeleteProjectResult =
  | { status: 'ok' }
  | { status: 'not_found' } // not a decodable, allowlisted, immediate-child directory
  | { status: 'symlink' }; // no single real-directory entry names it — a link, or an alias

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

  /** The root resolved the way the allowlist compares it; null when it cannot be. */
  async function canonicalRootPath(): Promise<string | null> {
    if (root === null) return null;
    try {
      return await realpath(root);
    } catch {
      return null;
    }
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

    /**
     * The configured root, resolved — resolved because that is the spelling the
     * allowlist compares against, so a root that is itself a symlink still stops
     * a walk from a project inside it: a caller comparing the two would otherwise
     * walk past the root and read the parent of the deployment.
     *
     * Unresolvable (gone, unreadable) is null, exactly like an unconfigured one:
     * there is no directory to bound a read by, which leaves the caller with the
     * project it was asked about and nothing above it.
     */
    async canonicalRoot(): Promise<string | null> {
      return canonicalRootPath();
    },

    /**
     * One `mkdir` at the root, and then the same allowlist every other answer
     * goes through: the id is the canonical path (05 §3), so canonicalizing the
     * new directory is what makes it the row a later rescan lists rather than a
     * second spelling of it.
     */
    async createProject(name: string): Promise<CreateProjectResult> {
      if (root === null || allowlist === null) return { status: 'no_root' };

      // The drawer's own rule, re-used rather than copied: one clean segment.
      const base = cleanSegment(name);
      // …and discovery's, which is not `name()`'s business: a dot-directory is
      // skipped by the scan, so a project created under one would be a
      // directory the user could never see. The drawer lists `.env` as an
      // ordinary file, so this rule is about *projects*, not names.
      if (base === null || base.startsWith('.')) return { status: 'invalid_name' };

      const target = path.join(root, base);
      // The `lstat` pre-check plus the non-recursive `mkdir` below is the same
      // never-overwrite pair `ScopedFs.createDirectory` uses. It is `lstat`
      // because a symlink at the name is in the way like anything else — a link
      // that resolves inside the root is a legitimate project already.
      if ((await lstatOrNull(target)) !== null) return { status: 'exists' };

      try {
        await mkdir(target);
      } catch (error) {
        // The race the pre-check cannot close: `mkdir` refuses an existing name
        // without writing over it.
        if (isErrno(error, 'EEXIST')) return { status: 'exists' };
        // A root that is not there — or is not a directory at all — is nowhere
        // to create, and the honest answer is not a silent success (unlike
        // `listProjects`, whose empty list is the truth about an empty root).
        // `mkdir` reports the two differently by platform: ENOENT where the
        // parent is missing, ENOTDIR where it is a plain file.
        if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return { status: 'no_root' };
        // A root we are not allowed to write to is a real fault, not an empty
        // answer, so it stays the 500 it falls through to.
        throw error;
      }

      // A root that cannot be canonicalized (gone between the `mkdir` and here,
      // say) is the same unusable root — the directory now exists, but there is
      // no id to name it by.
      const canonical = await allowlist.canonicalizeInsideRoot(target);
      if (canonical === null) return { status: 'no_root' };

      // The name comes off the canonical path, exactly as `resolveProject`
      // reads it, so the row this answers is the row an id resolves to — a
      // filesystem that stores the segment differently than it was asked for
      // (a trailing dot, a case rewrite) cannot make the two disagree.
      return {
        status: 'ok',
        project: { id: toProjectId(canonical), name: path.basename(canonical), path: canonical },
      };
    },

    /**
     * The delete is the mirror of the scan, not of the decode: the requested
     * path is canonicalized (so an id is never authorization), then the root is
     * re-scanned to find which of *its* entries that canonical path names. A
     * project is an immediate child, so the root itself, a file, and a deeper
     * directory all fail the same way — `not_found`.
     */
    async deleteProject(id: string): Promise<DeleteProjectResult> {
      if (root === null || allowlist === null) return { status: 'not_found' };

      const requested = decodeProjectId(id);
      if (requested === null) return { status: 'not_found' };

      const canonical = await allowlist.canonicalizeInsideRoot(requested);
      if (canonical === null) return { status: 'not_found' };

      // The root itself cannot be deleted. `dirname` is enough to tell "an
      // immediate child" from the root and from anything below a project: both
      // sides are canonical, so the comparison is about directories rather
      // than spellings.
      const canonicalRoot = await canonicalRootPath();
      if (canonicalRoot === null || path.dirname(canonical) !== canonicalRoot) {
        return { status: 'not_found' };
      }
      if (!(await isDirectory(canonical))) return { status: 'not_found' };

      let entries: Dirent[];
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        warn(`could not read projects root ${root}: ${String(error)}`);
        return { status: 'not_found' };
      }

      // The scan decides, not the id: the entry to remove comes off `readdir`,
      // never out of the decoded path. Plain files are skipped exactly as the
      // scan skips them — a file cannot name a project directory.
      const matches: Dirent[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const candidate = await allowlist.canonicalizeInsideRoot(path.join(root, entry.name));
        if (candidate === canonical) matches.push(entry);
      }

      // Exactly one entry may name the canonical path, and it must be the
      // directory itself, never a link to it. `rm` on a link would unlink the
      // link and leave every file in place, which would make the delete a lie;
      // following it would destroy a target the user did not name. More than one
      // match is the same refusal: deleting by id would have to guess which label
      // the user meant (decision 87, D6).
      const [match] = matches;
      if (
        matches.length !== 1 ||
        match === undefined ||
        match.isSymbolicLink() ||
        !match.isDirectory()
      ) {
        return { status: 'symlink' };
      }

      // The entry's own name off the scan, never a path rebuilt from the id.
      // `rm` does not follow a link in the final segment, so even a swap between
      // the scan and here cannot reach outside the root.
      await rm(path.join(root, match.name), { recursive: true });
      return { status: 'ok' };
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

/** `lstat` without following the final segment — `null` when the entry is absent. */
async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await lstat(target);
  } catch {
    return null;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}
