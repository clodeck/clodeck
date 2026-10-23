import type { BuildStamp } from '@clodeck/shared';
import type { ReactElement } from 'react';

/**
 * The running build, as the one line the login screen and the sidebar header
 * share (ticket 94, ADR 0004).
 *
 * It renders what the stamp says and shortens nothing but the commit — and only
 * when the commit is a full 40-hex SHA. `dev` and `unknown` are shown as
 * themselves: a masked stamp would turn "I cannot tell which build this is"
 * into a plausible-looking commit, which is the lie the stamp exists to prevent.
 * The full SHA stays reachable in `title`, because seven characters identify a
 * build to a person and forty identify it to git.
 */
export function BuildStampLine({
  build,
  className,
}: {
  /** The stamp `/healthz` answered, or `null` while it is still in flight. */
  build: BuildStamp | null;
  className?: string;
}): ReactElement | null {
  if (build === null) return null;

  return (
    <p className={className} title={build.commit}>
      {formatBuildStamp(build)}
    </p>
  );
}

/** The line's text: `fcbd770 · 2026-10-23 14:05`, plus `-dirty` when it applies. */
export function formatBuildStamp(build: BuildStamp): string {
  const commit = `${shortCommit(build.commit)}${build.dirty ? '-dirty' : ''}`;
  const built = build.builtAt === null ? null : formatBuiltAt(build.builtAt);
  return built === null ? commit : `${commit} · ${built}`;
}

/** A full 40-hex SHA is shortened to seven; any other word is shown whole. */
const FULL_SHA = /^[0-9a-f]{40}$/;

function shortCommit(commit: string): string {
  return FULL_SHA.test(commit) ? commit.slice(0, 7) : commit;
}

/**
 * `builtAt` in the browser's own local time, `YYYY-MM-DD HH:MM`. The server
 * sends ISO so the instant is unambiguous; the person reading the line wants
 * the clock on their wall, which is why the conversion is here and not there.
 * `null` for a value that is not a date, so the commit still reads on its own.
 */
export function formatBuiltAt(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}
