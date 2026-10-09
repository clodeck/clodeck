import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * The allowlist seam (wayfinder 05 §5): the configured projects root is the
 * only authorization boundary, and every operation re-validates against it —
 * decoding a project id to a path is never treated as authorization.
 *
 * Both sides of the comparison are `realpath`-resolved, so a `..` segment or a
 * symlink cannot escape the root by spelling.
 */
export interface Allowlist {
  readonly root: string;
  /** The canonical path when `candidate` resolves inside the root; otherwise null. */
  canonicalizeInsideRoot(candidate: string): Promise<string | null>;
}

export function createAllowlist(root: string): Allowlist {
  return {
    root,
    async canonicalizeInsideRoot(candidate) {
      const [resolvedRoot, resolvedCandidate] = await Promise.all([
        realpathOrNull(root),
        realpathOrNull(candidate),
      ]);

      if (resolvedRoot === null || resolvedCandidate === null) {
        return null;
      }

      return isInsideRoot(resolvedRoot, resolvedCandidate) ? resolvedCandidate : null;
    },
  };
}

/**
 * Containment by `path.relative`, which handles the separators and drive
 * letters of the host platform: an escape is `..`, `..<sep>…`, or a path on
 * another volume. A sibling merely *named* `..foo` is still inside.
 *
 * Private on purpose: `canonicalizeInsideRoot` is the one door, and it is the
 * only thing that should ever see an un-resolved string.
 */
function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Any resolution failure (ENOENT, EACCES, a symlink loop, …) is a rejection. */
async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}
