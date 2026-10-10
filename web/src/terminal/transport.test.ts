import { afterEach, describe, expect, it, vi } from 'vitest';

import { debounce, postTerminalSize, resizeUrl, terminalSocketUrl } from './transport';

/**
 * The transport's pure edges — URL building, the resize payload, the debounce —
 * are the only parts of the terminal seam a node test can reach: `useTerminal`
 * owns a real xterm instance and a real socket, so its behaviour is verified by
 * typecheck/build plus the manual dev loop (spec-03 §Testing Decisions). These
 * tests pin the parts that have no DOM, so the seam is not entirely unasserted.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('terminalSocketUrl', () => {
  it('resolves /ws/terminal against the page and carries the project id', () => {
    expect(terminalSocketUrl('proj-a', 'http://localhost:5173/')).toBe(
      'ws://localhost:5173/ws/terminal?projectId=proj-a',
    );
  });

  it('upgrades to wss on an https page and encodes an awkward id', () => {
    expect(terminalSocketUrl('proj/a', 'https://host.example/app/')).toBe(
      'wss://host.example/ws/terminal?projectId=proj%2Fa',
    );
  });
});

describe('resizeUrl', () => {
  it('builds the resize endpoint under /api with the id encoded', () => {
    expect(resizeUrl('proj/a')).toBe('/api/projects/proj%2Fa/terminal/size');
  });
});

describe('postTerminalSize', () => {
  it('POSTs {cols, rows} as JSON to the resize endpoint and reports the ok status', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(postTerminalSize('proj-a', { cols: 132, rows: 43 })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/proj-a/terminal/size');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ cols: 132, rows: 43 });
  });

  it('reports false when the server refuses the size (no terminal open yet)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: false } as Response)));

    await expect(postTerminalSize('proj-a', { cols: 80, rows: 24 })).resolves.toBe(false);
  });
});

describe('debounce', () => {
  it('fires once, on the trailing edge, with the last arguments', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const debounced = debounce((value: number) => {
      seen.push(value);
    }, 100);

    debounced.call(1);
    debounced.call(2);
    debounced.call(3);
    expect(seen).toEqual([]);

    vi.advanceTimersByTime(99);
    expect(seen).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(seen).toEqual([3]);
  });

  it('drops a pending call on cancel', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced.call(1);
    debounced.cancel();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();
  });
});
