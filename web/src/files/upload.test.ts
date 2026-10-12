import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { exceedsUploadCap, OVER_LIMIT, summarizeUploads, type UploadOutcome } from './upload';

/**
 * The upload batch's two pure halves: the client-side cap check (the same
 * constant the route's body limit is) and the one summary a settled batch
 * speaks. The requests themselves are asserted in `FilePanel.test.tsx`, because
 * "no request was made" is a transport fact.
 */

const ok = (name: string): UploadOutcome => ({ ok: true, name });
const failed = (name: string, reason: string): UploadOutcome => ({ ok: false, name, reason });

describe('exceedsUploadCap', () => {
  it('is the shared cap, and it is exclusive (the cap itself is allowed)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_UPLOAD_MB * 1024 * 1024);
    expect(exceedsUploadCap(MAX_UPLOAD_BYTES)).toBe(false);
    expect(exceedsUploadCap(MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(exceedsUploadCap(0)).toBe(false);
  });
});

describe('summarizeUploads', () => {
  it('names the one file a single-file upload brought in', () => {
    expect(summarizeUploads([ok('notes.md')])).toEqual({ message: 'uploaded notes.md', detail: null });
  });

  it('counts a clean batch instead of listing it', () => {
    expect(summarizeUploads([ok('a'), ok('b'), ok('c')])).toEqual({ message: '3 uploaded', detail: null });
  });

  it('splits a mixed batch into what landed and what did not, with the first reason kept', () => {
    const summary = summarizeUploads([
      ok('a'),
      failed('b', '409 Conflict: already exists'),
      ok('c'),
      failed('d', 'over the 200 MB upload limit'),
    ]);

    // `3 uploaded · 2 failed` is the prototype's shape (`common.js:611-623`); the
    // message stays glanceable and the reason rides along rather than being lost.
    expect(summary).toEqual({
      message: '2 uploaded · 2 failed',
      detail: '409 Conflict: already exists',
    });
  });

  it('reports a batch where nothing landed as the failures alone', () => {
    expect(summarizeUploads([failed('big.bin', OVER_LIMIT), failed('huge.iso', OVER_LIMIT)])).toEqual({
      message: '2 failed',
      detail: OVER_LIMIT,
    });
    expect(summarizeUploads([failed('big.bin', OVER_LIMIT)])).toEqual({ message: '1 failed', detail: OVER_LIMIT });
  });

  it('says nothing at all about a batch with no files in it', () => {
    expect(summarizeUploads([])).toBeNull();
  });
});

describe('OVER_LIMIT', () => {
  it('names the cap the overlay shows, from the one constant', () => {
    expect(OVER_LIMIT).toBe(`over the ${String(MAX_UPLOAD_MB)} MB upload limit`);
  });
});
