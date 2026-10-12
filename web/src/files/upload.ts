import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@clodeck/shared';

/**
 * The upload batch: what one file's upload came to, whether a file is even worth
 * sending, and the single message a settled batch speaks.
 *
 * Two rules are the point of the module. A batch reports **once** — independent
 * requests whose failures are counted, never a flurry of notices stomping each
 * other — and a file over the cap is **refused here**, so the server's `413`
 * stops being the way a 300 MB drop is discovered. The cap is
 * {@link MAX_UPLOAD_BYTES} from the shared contract, the same constant the
 * route's body limit is, so the two cannot disagree.
 */

/** What happened to one file in a batch. A failure carries its reason; nothing swallows it. */
export type UploadOutcome =
  | { ok: true; name: string }
  | { ok: false; name: string; reason: string };

/** The refusal an oversize file gets, in the words the overlay uses its number in. */
export const OVER_LIMIT = `over the ${String(MAX_UPLOAD_MB)} MB upload limit`;

/**
 * The client half of the cap, checked before anything is sent. The cap itself is
 * allowed (the server's `413` is for strictly larger), and the server keeps its
 * check as the backstop for a request that bypasses this one.
 */
export function exceedsUploadCap(size: number): boolean {
  return size > MAX_UPLOAD_BYTES;
}

/** The one message a settled batch says: the counts, plus the first failure's reason. */
export interface UploadNotice {
  message: string;
  detail: string | null;
}

/**
 * Fold a settled batch into one notice, or `null` when there was nothing to
 * upload. A clean run reads as the prototype does — the file's name for one,
 * otherwise a count. A mixed run says both counts, and the first failure's
 * reason rides along as the detail rather than being one of N swallowed
 * messages; the failures were independent, so they do not abort each other.
 */
export function summarizeUploads(outcomes: readonly UploadOutcome[]): UploadNotice | null {
  if (outcomes.length === 0) return null;

  const added = outcomes.filter((outcome) => outcome.ok).length;
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const detail = failures[0]?.reason ?? null;

  if (failures.length === 0) {
    // The common case is one file, and it reads better by name than as a count.
    const single = outcomes.length === 1 ? outcomes[0] : undefined;
    return { message: single === undefined ? `${String(added)} uploaded` : `uploaded ${single.name}`, detail: null };
  }
  if (added === 0) return { message: `${String(failures.length)} failed`, detail };

  return { message: `${String(added)} uploaded · ${String(failures.length)} failed`, detail };
}
