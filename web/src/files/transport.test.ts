import type { FileEntry } from '@clodeck/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  contentUrl,
  createEntry,
  fetchContent,
  fetchEntries,
  filesUrl,
  removeEntry,
  renameEntry,
  renameUrl,
  uploadEntry,
} from './transport';

/**
 * The transport's pure edges: the URLs the drawer speaks to (ticket 19's REST
 * contract) and the response/status mapping. They live apart from `useFiles` so
 * the parts with no React stay testable under the node test environment, exactly
 * as the terminal's `transport.ts` does.
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

describe('URLs', () => {
  it('builds the listing endpoint with the id and the relative path encoded', () => {
    expect(filesUrl('proj/a', 'sub dir/f.txt')).toBe('/api/projects/proj%2Fa/files?path=sub%20dir%2Ff.txt');
  });

  it('addresses the root with an empty path', () => {
    expect(filesUrl('p', '')).toBe('/api/projects/p/files?path=');
    expect(contentUrl('p', '')).toBe('/api/projects/p/files/content?path=');
  });

  it('builds the content and rename endpoints under the same files scope', () => {
    expect(contentUrl('p', 'a.txt')).toBe('/api/projects/p/files/content?path=a.txt');
    expect(renameUrl('p', 'a.txt')).toBe('/api/projects/p/files/rename?path=a.txt');
  });
});

describe('fetchEntries', () => {
  it('GETs the listing and decodes the entries envelope', async () => {
    const entries: FileEntry[] = [{ type: 'directory', name: 'src' }];
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, { entries })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchEntries('p', 'sub')).resolves.toEqual(entries);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/p/files?path=sub');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('refuses a body whose entry type is not one of the three arms', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, { entries: [{ type: 'fifo', name: 'x' }] }))));

    await expect(fetchEntries('p', '')).rejects.toThrow('unexpected response shape');
  });

  it("maps a failure to the server's { error } envelope and the status line", async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(404, { error: 'not found' }, 'Not Found'))));

    await expect(fetchEntries('p', 'missing')).rejects.toThrow('404 Not Found: not found');
  });
});

describe('fetchContent', () => {
  it('decodes a text file', async () => {
    const content = { kind: 'text', content: 'hi', truncated: false, size: 2 };
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, { content }))));

    await expect(fetchContent('p', 'a.txt')).resolves.toEqual(content);
  });

  it('decodes a binary file (a 200, not an error)', async () => {
    const content = { kind: 'binary', size: 4096 };
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, { content }))));

    await expect(fetchContent('p', 'logo.png')).resolves.toEqual(content);
  });
});

describe('write operations', () => {
  it('POSTs a create with the kind in the body', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(201, {})));
    vi.stubGlobal('fetch', fetchMock);

    await createEntry('p', 'notes.txt', 'file');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/p/files?path=notes.txt');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ kind: 'file' });
  });

  it('POSTs a rename with the new name in the body', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, {})));
    vi.stubGlobal('fetch', fetchMock);

    await renameEntry('p', 'old.txt', 'new.txt');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/p/files/rename?path=old.txt');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ to: 'new.txt' });
  });

  it('DELETEs the addressed path', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, {})));
    vi.stubGlobal('fetch', fetchMock);

    await removeEntry('p', 'trash.txt');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/p/files?path=trash.txt');
    expect(init?.method).toBe('DELETE');
  });

  it('PUTs a file as a raw octet-stream body', async () => {
    const file = new File(['bytes'], 'asset.bin');
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(201, {})));
    vi.stubGlobal('fetch', fetchMock);

    await uploadEntry('p', 'assets/asset.bin', file);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/projects/p/files/content?path=assets%2Fasset.bin');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/octet-stream');
    expect(init?.body).toBe(file);
  });

  it('surfaces a 409 conflict as a rejection', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(409, { error: 'exists' }, 'Conflict'))));

    await expect(createEntry('p', 'dup.txt', 'file')).rejects.toThrow('409 Conflict: exists');
  });

  it('surfaces an oversize upload (413) as a rejection', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(413, { error: 'too large' }, 'Payload Too Large'))));

    await expect(uploadEntry('p', 'big.bin', new File(['x'], 'big.bin'))).rejects.toThrow('413 Payload Too Large: too large');
  });
});
