/**
 * Row metadata: how a file's size and its modified time read on a row. Both
 * helpers are pure and take everything they need as arguments (`now` included),
 * so the tree (this ticket) and the flat list write the same text instead of
 * each rolling its own — one formatter, not two.
 *
 * **Directories and symlinks get nothing.** The wire type carries no `size` or
 * `mtime` for them (`shared/src/files.ts`), so there is no value to format and a
 * row for one renders blank rather than a fabricated number.
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * Bytes as the shortest unit that can carry them: `512 B`, `1.5 KB`, `4.0 MB`.
 * The integer/one-decimal split (and the step at 1024) is the prototype's
 * (`common.js:87-88`), extended past its `KB`-only ceiling because real files
 * are bigger than its mocks were.
 */
export function formatSize(bytes: number): string {
  if (bytes < KB) return `${String(bytes)} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A modified time as the reader cares about it: how long ago, in the largest
 * unit that still says something, until that stops helping — past a week a
 * relative count is harder to place than the date itself. The caller keeps the
 * exact server timestamp beside this (it is the row's tooltip), so nothing is
 * lost by rounding here.
 *
 * A timestamp `Date.parse` cannot read is handed back unchanged: the raw value
 * is at least true, and the row is the server's string, not ours.
 */
export function formatModified(mtime: string, now: number): string {
  const time = Date.parse(mtime);
  if (!Number.isFinite(time)) return mtime;

  const elapsed = now - time;
  if (elapsed < MINUTE) return 'just now';

  const minutes = Math.floor(elapsed / MINUTE);
  if (minutes < 60) return `${String(minutes)}m ago`;

  const hours = Math.floor(elapsed / HOUR);
  if (hours < 24) return `${String(hours)}h ago`;
  if (hours < 48) return 'yesterday';

  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${String(days)}d ago`;

  return localDate(new Date(time));
}

/** `YYYY-MM-DD` in the reader's own timezone — a plain date, no locale surprises. */
function localDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
