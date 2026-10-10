import type { FileContent, FileEntry } from '@clodeck/shared';

/**
 * The file drawer's transport: the four REST endpoints ticket 17/19 put under
 * `/api/projects/:id/files`, plus the response/status mapping. Kept apart from
 * `useFiles` exactly as the terminal's `transport.ts` is kept apart from
 * `useTerminal` — URL building and the wire guards have no React and are
 * testable under the node test environment.
 *
 * Every operation addresses one entry by a single relative `?path=` (empty =
 * root), and the server's error envelope is `{ error }` (spec-04 §"Status-code
 * discipline"), so one `failureMessage` maps every non-2xx here.
 */

const BASE = '/api/projects';

export function filesUrl(projectId: string, path: string): string {
  return `${BASE}/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`;
}

export function contentUrl(projectId: string, path: string): string {
  return `${BASE}/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(path)}`;
}

export function renameUrl(projectId: string, path: string): string {
  return `${BASE}/${encodeURIComponent(projectId)}/files/rename?path=${encodeURIComponent(path)}`;
}

export function saveUrl(projectId: string, path: string): string {
  return `${BASE}/${encodeURIComponent(projectId)}/files/save?path=${encodeURIComponent(path)}`;
}

/** `GET /files` — one directory's entries. */
export async function fetchEntries(projectId: string, path: string, signal?: AbortSignal): Promise<FileEntry[]> {
  const response = await fetch(filesUrl(projectId, path), { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isEntriesEnvelope(body)) throw new Error('unexpected response shape');
  return body.entries;
}

/** `GET /files/content` — one file's content (binary is a `200`, not an error). */
export async function fetchContent(projectId: string, path: string, signal?: AbortSignal): Promise<FileContent> {
  const response = await fetch(contentUrl(projectId, path), { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isContentEnvelope(body)) throw new Error('unexpected response shape');
  return body.content;
}

/** `POST /files` — a new empty file or folder. Create never overwrites. */
export async function createEntry(projectId: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  const response = await fetch(filesUrl(projectId, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/** `POST /files/rename` — rename in place, `to` a bare new name. */
export async function renameEntry(projectId: string, path: string, to: string): Promise<void> {
  const response = await fetch(renameUrl(projectId, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to }),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/** `DELETE /files` — remove the addressed entry (the caller confirms first). */
export async function removeEntry(projectId: string, path: string): Promise<void> {
  const response = await fetch(filesUrl(projectId, path), { method: 'DELETE' });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/** `PUT /files/content` — upload raw bytes; the file is the body. */
export async function uploadEntry(projectId: string, path: string, file: File): Promise<void> {
  const response = await fetch(contentUrl(projectId, path), {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/** `POST /files/save` — overwrite an existing file's content (the editable toggle's save). */
export async function saveContent(projectId: string, path: string, content: string): Promise<void> {
  const response = await fetch(saveUrl(projectId, path), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: content,
  });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/**
 * The server's REST error shape is `{ error }` (spec-04 §"Status-code
 * discipline"); a non-JSON body falls back to the status line. Same idiom as
 * `useSessions.ts`.
 */
async function failureMessage(response: Response): Promise<string> {
  const status = `${String(response.status)} ${response.statusText}`.trim();
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === 'string') return `${status}: ${error}`;
    }
  } catch {
    // A non-JSON body falls back to the status line.
  }
  return status;
}

/**
 * The contract is compile-time; the wire is not. These guards turn a drifted
 * body into an error state instead of a broken render, and refuse an entry
 * `type`/content `kind` outside the union so the renderer's exhaustive `switch`
 * never sees an arm it cannot handle.
 */
function isEntriesEnvelope(body: unknown): body is { entries: FileEntry[] } {
  if (typeof body !== 'object' || body === null) return false;
  const entries = (body as { entries?: unknown }).entries;
  return Array.isArray(entries) && entries.every(isFileEntry);
}

function isFileEntry(value: unknown): value is FileEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  switch (entry['type']) {
    case 'file':
      return typeof entry['name'] === 'string' && typeof entry['size'] === 'number' && typeof entry['mtime'] === 'string';
    case 'directory':
    case 'symlink':
      return typeof entry['name'] === 'string';
    default:
      return false;
  }
}

function isContentEnvelope(body: unknown): body is { content: FileContent } {
  if (typeof body !== 'object' || body === null) return false;
  const content = (body as { content?: unknown }).content;
  return isFileContent(content);
}

function isFileContent(value: unknown): value is FileContent {
  if (typeof value !== 'object' || value === null) return false;
  const content = value as Record<string, unknown>;
  switch (content['kind']) {
    case 'text':
      return (
        typeof content['content'] === 'string' &&
        typeof content['truncated'] === 'boolean' &&
        typeof content['size'] === 'number'
      );
    case 'binary':
      return typeof content['size'] === 'number';
    default:
      return false;
  }
}
