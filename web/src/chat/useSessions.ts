import type { Project, SessionMessage, SessionSummary } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * The history data seam, shaped like `useProjects`: a discriminated state union
 * and an effect that owns the request. It reads the two REST endpoints ticket 09
 * put at `/api/projects/:id/sessions` and `.../sessions/:sid/messages` — the
 * server's read-only view of the Agent SDK's on-disk transcripts — so the
 * browser can list past conversations and replay one with no SDK and no store
 * of its own (spec-02 §"Session history & resume (REST)").
 *
 * The list and the open transcript are separate states because they load on
 * separate triggers: the list on mount, the transcript when a session is opened.
 */
export type SessionsState =
  | { status: 'loading' }
  | { status: 'ready'; sessions: SessionSummary[] }
  | { status: 'error'; message: string };

export type TranscriptState =
  | { status: 'closed' }
  | { status: 'loading'; sessionId: string }
  | { status: 'ready'; sessionId: string; messages: SessionMessage[] }
  | { status: 'error'; sessionId: string; message: string };

export interface SessionsQuery {
  sessions: SessionsState;
  transcript: TranscriptState;
  reload: () => void;
  /** Opens a stored session's transcript; a different id replaces the open one. */
  open: (sessionId: string) => void;
  /** Closes the transcript and returns the panel to the live chat. */
  close: () => void;
  /**
   * Hard-delete one session on disk, then follow it here: the row leaves the
   * list, and an open transcript of it closes back to the live chat. Rejects
   * with the server's reason (a turn writing the session, say) and changes
   * nothing in that case.
   */
  delete: (sessionId: string) => Promise<void>;
}

export function useSessions(project: Project): SessionsQuery {
  const [sessions, setSessions] = useState<SessionsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptState>({ status: 'closed' });

  useEffect(() => {
    const controller = new AbortController();
    setSessions({ status: 'loading' });

    fetchSessions(project.id, controller.signal).then(
      (list) => {
        if (!controller.signal.aborted) setSessions({ status: 'ready', sessions: list });
      },
      (error: unknown) => {
        // An aborted request is this effect being replaced, not a failure.
        if (!controller.signal.aborted) setSessions({ status: 'error', message: messageOf(error) });
      },
    );

    return () => controller.abort();
  }, [project.id, attempt]);

  useEffect(() => {
    if (openId === null) {
      setTranscript({ status: 'closed' });
      return;
    }

    const controller = new AbortController();
    setTranscript({ status: 'loading', sessionId: openId });

    fetchTranscript(project.id, openId, controller.signal).then(
      (messages) => {
        if (!controller.signal.aborted) setTranscript({ status: 'ready', sessionId: openId, messages });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setTranscript({ status: 'error', sessionId: openId, message: messageOf(error) });
      },
    );

    return () => controller.abort();
  }, [project.id, openId]);

  const remove = useCallback(
    async (sessionId: string): Promise<void> => {
      await requestDelete(project.id, sessionId);
      setSessions((current) =>
        current.status === 'ready'
          ? { status: 'ready', sessions: current.sessions.filter((session) => session.id !== sessionId) }
          : current,
      );
      // A deleted transcript has nothing left to show; closing it is the same
      // surface `close` gives, and the list the user came from stays open.
      setOpenId((current) => (current === sessionId ? null : current));
    },
    [project.id],
  );

  return {
    sessions,
    transcript,
    reload: useCallback(() => setAttempt((count) => count + 1), []),
    open: useCallback((sessionId: string) => setOpenId(sessionId), []),
    close: useCallback(() => setOpenId(null), []),
    delete: remove,
  };
}

/** `GET /api/projects/:id/sessions` answers `{ sessions: SessionSummary[] }`. */
async function fetchSessions(projectId: string, signal: AbortSignal): Promise<SessionSummary[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sessions`, {
    signal,
    headers: { accept: 'application/json' },
  });

  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isSessionsEnvelope(body)) throw new Error('unexpected response shape');

  return body.sessions;
}

/** `.../sessions/:sid/messages` answers `{ messages: SessionMessage[] }`. */
async function fetchTranscript(
  projectId: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<SessionMessage[]> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/messages`;
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });

  if (!response.ok) throw new Error(await failureMessage(response));

  const body: unknown = await response.json();
  if (!isTranscriptEnvelope(body)) throw new Error('unexpected response shape');

  return body.messages;
}

/** `DELETE .../sessions/:sid` answers `204` with no body. */
async function requestDelete(projectId: string, sessionId: string): Promise<void> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`;
  const response = await fetch(url, { method: 'DELETE', headers: { accept: 'application/json' } });

  if (!response.ok) throw new Error(await failureMessage(response));
}

/** The server's REST error shape is `{ error }` (server/src/sessions.ts). */
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
 * The contract is compile-time; the wire is not. One guard per response turns a
 * drifted body into the error state instead of a broken render (same idiom as
 * `useProjects.ts`).
 */
function isSessionsEnvelope(body: unknown): body is { sessions: SessionSummary[] } {
  if (typeof body !== 'object' || body === null) return false;
  const sessions = (body as { sessions?: unknown }).sessions;
  return Array.isArray(sessions) && sessions.every(isSessionSummary);
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof SessionSummary, unknown>>;
  return typeof candidate.id === 'string' && typeof candidate.title === 'string';
}

function isTranscriptEnvelope(body: unknown): body is { messages: SessionMessage[] } {
  if (typeof body !== 'object' || body === null) return false;
  const messages = (body as { messages?: unknown }).messages;
  return Array.isArray(messages) && messages.every(isSessionMessage);
}

function isSessionMessage(value: unknown): value is SessionMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { role?: unknown; content?: unknown };
  return (candidate.role === 'user' || candidate.role === 'assistant') && Array.isArray(candidate.content);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
