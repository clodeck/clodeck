import { describe, expect, it } from 'vitest';

import { formatModified, formatSize } from './format';

/**
 * The row-metadata formatter: pure, so it is pinned here over its boundaries
 * rather than through a rendered row. `now` is always passed in, which is what
 * makes the relative half testable at all.
 */

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

/** An instant `ms` before {@link NOW}, as the server would report it. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatSize', () => {
  it('counts bytes below a kibibyte', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1)).toBe('1 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('steps up a unit at each 1024 boundary, to one decimal', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(4.5 * 1024 * 1024)).toBe('4.5 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
});

describe('formatModified', () => {
  it('counts minutes, then hours, for recent changes', () => {
    expect(formatModified(ago(0), NOW)).toBe('just now');
    expect(formatModified(ago(59_000), NOW)).toBe('just now');
    expect(formatModified(ago(60_000), NOW)).toBe('1m ago');
    expect(formatModified(ago(2 * 60_000), NOW)).toBe('2m ago');
    expect(formatModified(ago(59 * 60_000), NOW)).toBe('59m ago');
    expect(formatModified(ago(60 * 60_000), NOW)).toBe('1h ago');
    expect(formatModified(ago(3 * 60 * 60_000), NOW)).toBe('3h ago');
    expect(formatModified(ago(23 * 60 * 60_000), NOW)).toBe('23h ago');
  });

  it('says yesterday between one and two days, then counts days', () => {
    expect(formatModified(ago(24 * 60 * 60_000), NOW)).toBe('yesterday');
    expect(formatModified(ago(47 * 60 * 60_000), NOW)).toBe('yesterday');
    expect(formatModified(ago(48 * 60 * 60_000), NOW)).toBe('2d ago');
    expect(formatModified(ago(6 * 24 * 60 * 60_000), NOW)).toBe('6d ago');
  });

  it('falls back to a plain local date a week out or more', () => {
    // Built in local time and read back in local time, so the assertion holds in
    // any timezone the suite happens to run in.
    const week = new Date(2026, 9, 5, 9, 0, 0);
    expect(formatModified(week.toISOString(), NOW)).toBe('2026-10-05');
    expect(formatModified(new Date(2026, 0, 5, 9, 0, 0).toISOString(), NOW)).toBe('2026-01-05');
  });

  it('hands back a timestamp it cannot read rather than inventing a time', () => {
    expect(formatModified('not-a-date', NOW)).toBe('not-a-date');
  });
});
