// @vitest-environment jsdom
import type { BuildStamp } from '@clodeck/shared';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBuildStamp } from './useBuildStamp';

/**
 * The client's one read of `/healthz` (ticket 94). What the server puts in the
 * body is its own suite's business; what is pinned here is the hook's half — the
 * request it makes, the stamp it accepts, and the honest `unknown` every
 * fallback lands on. A failure must not leave the line undrawn or invent a
 * commit: "I cannot tell" is a state the screen is allowed to show.
 */

const SHA = 'fcbd770000000000000000000000000000000000';
const STAMP: BuildStamp = { commit: SHA, builtAt: '2026-10-23T10:35:00.000Z', dirty: false };

/** A `fetch` that answers the given body, and every call it received. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Server Error',
      json: () => Promise.resolve(body),
    } as Response),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

describe('the build stamp hook', () => {
  it('reads /healthz once, uncached, and answers the stamp it carries', async () => {
    const fetch = stubFetch({ status: 'ok', build: STAMP });

    const { result } = renderHook(() => useBuildStamp());

    await waitFor(() => {
      expect(result.current).toEqual(STAMP);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/healthz', expect.objectContaining({ cache: 'no-store' }));
  });

  it('answers unknown when the server refuses the request', async () => {
    stubFetch({ error: 'not found' }, 503);

    const { result } = renderHook(() => useBuildStamp());

    await waitFor(() => {
      expect(result.current).toEqual({ commit: 'unknown', builtAt: null, dirty: false });
    });
  });

  it('answers unknown when the body is not the contract', async () => {
    // An older server's `{"status":"ok"}`, and a proxy's own page, both land here.
    stubFetch({ status: 'ok' });

    const { result } = renderHook(() => useBuildStamp());

    await waitFor(() => {
      expect(result.current).toEqual({ commit: 'unknown', builtAt: null, dirty: false });
    });
  });

  it('answers unknown when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));

    const { result } = renderHook(() => useBuildStamp());

    await waitFor(() => {
      expect(result.current).toEqual({ commit: 'unknown', builtAt: null, dirty: false });
    });
  });
});
