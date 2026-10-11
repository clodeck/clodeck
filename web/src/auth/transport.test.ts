import type { Principal } from '@clodeck/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMe, login, logout } from './transport';

/**
 * The auth client's pure edges: the three endpoints it speaks to, the body it
 * posts, and how each status maps to what the login screen shows. No React and
 * no rendered component here — that is the same split the terminal's and the
 * file drawer's `transport.test.ts` use, and the reason they run under the
 * default node environment.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown, statusText = 'Status'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as Response;
}

/** A fetch stub, plus the calls it recorded. */
function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(responses.shift() ?? jsonResponse(500, {})));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('login', () => {
  it('POSTs the password as JSON and reports success', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { ok: true }));

    await expect(login('hunter2')).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/login');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(init?.body).toBe(JSON.stringify({ password: 'hunter2' }));
  });

  it('maps a 401 to a wrong-password refusal, carrying the server’s message', async () => {
    stubFetch(jsonResponse(401, { error: 'invalid password' }));

    await expect(login('nope')).resolves.toEqual({
      ok: false,
      reason: 'invalid',
      message: '401 Status: invalid password',
    });
  });

  it('maps a 429 to a lockout refusal, distinct from a wrong password', async () => {
    stubFetch(jsonResponse(429, { error: 'too many failed attempts; try again later' }));

    const result = await login('even-the-right-one');

    expect(result).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('maps any other status, and a dead network, to a generic failure', async () => {
    stubFetch(jsonResponse(502, 'not json', 'Bad Gateway'));
    await expect(login('pw')).resolves.toMatchObject({ ok: false, reason: 'failed' });

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(login('pw')).resolves.toMatchObject({
      ok: false,
      reason: 'failed',
      message: 'offline',
    });
  });
});

describe('fetchMe', () => {
  it('GETs the session and returns its principal', async () => {
    const principal: Principal = { id: 'default', name: 'default' };
    const fetchMock = stubFetch(jsonResponse(200, { principal }));

    await expect(fetchMe()).resolves.toEqual(principal);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/me');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('answers null — not an error — when there is no session', async () => {
    stubFetch(jsonResponse(401, { error: 'authentication required' }));

    await expect(fetchMe()).resolves.toBeNull();
  });

  it('throws on a status it cannot interpret, and on a drifted body', async () => {
    stubFetch(jsonResponse(500, { error: 'boom' }));
    await expect(fetchMe()).rejects.toThrow('500 Status: boom');

    stubFetch(jsonResponse(200, { who: 'nobody' }));
    await expect(fetchMe()).rejects.toThrow('unexpected response shape');
  });
});

describe('logout', () => {
  it('POSTs to the logout route', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { ok: true }));

    await expect(logout()).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/logout');
    expect(init?.method).toBe('POST');
  });

  it('throws when the server refuses to end the session', async () => {
    stubFetch(jsonResponse(500, { error: 'boom' }));

    await expect(logout()).rejects.toThrow('500 Status: boom');
  });
});
