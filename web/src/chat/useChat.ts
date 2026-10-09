import {
  PROTOCOL_VERSION,
  type ApprovalResponsePayload,
  type ClientMessage,
  type Project,
  type ServerEvent,
} from '@clodeck/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyServerEvent,
  clearError,
  dismissApproval,
  emptyView,
  withUserPrompt,
  type ChatView,
} from './reducer';

/**
 * The chat data seam, shaped like `useProjects`: a discriminated state union
 * and a `useEffect` that owns the socket and cleans it up. All it does is move
 * frames and issue control messages — the event → view-model fold lives in
 * `reducer.ts`, which is why the streaming rules are testable without a DOM.
 */

export type ChatConnection = 'connecting' | 'live' | 'error';

export interface ChatController {
  view: ChatView;
  connection: ChatConnection;
  sendPrompt: (prompt: string) => void;
  interrupt: () => void;
  /** Answers the approval modal (Allow/Deny only for the MVP). */
  respond: (response: ApprovalResponsePayload) => void;
  dismissError: () => void;
}

/** First retry delay; doubles per attempt up to {@link MAX_BACKOFF_MS}. */
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

export function useChat(project: Project): ChatController {
  const [view, setView] = useState<ChatView>(emptyView);
  const [connection, setConnection] = useState<ChatConnection>('connecting');
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    // A new project is a new run: the previous view must not linger behind it.
    setView(emptyView());
    setConnection('connecting');

    const connect = (): void => {
      if (closed) return;
      setConnection('connecting');
      socket = new WebSocket(socketUrl(project.id));
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnection('live');
      };

      socket.onmessage = (event: MessageEvent) => {
        const serverEvent = parseServerEvent(event.data);
        // `snapshot` always arrives first, so a (re)connect rebuilds the whole
        // view before any live event can be folded onto it.
        if (serverEvent !== null) setView((current) => applyServerEvent(current, serverEvent));
      };

      // Any close that is not this effect tearing down is unexpected: back off
      // and reconnect, because the run lives on the server across the gap.
      socket.onclose = () => {
        if (closed) return;
        setConnection('error');
        timer = setTimeout(connect, nextBackoff(attempt));
        attempt += 1;
      };

      // `onerror` is always followed by `onclose`; reconnection is handled there.
      socket.onerror = () => undefined;
    };

    connect();

    return () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      if (socket !== null) {
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      socketRef.current = null;
    };
  }, [project.id]);

  const send = useCallback((message: ClientMessage): void => {
    const socket = socketRef.current;
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const sendPrompt = useCallback(
    (prompt: string): void => {
      const trimmed = prompt.trim();
      if (trimmed === '') return;
      // Shown at once; the fold drops the bus's echo if one arrives.
      setView((current) => withUserPrompt(current, trimmed));
      const message: ClientMessage = {
        v: PROTOCOL_VERSION,
        id: newMessageId(),
        type: 'send_prompt',
        payload: { prompt: trimmed },
      };
      send(message);
    },
    [send],
  );

  const interrupt = useCallback((): void => {
    const message: ClientMessage = { v: PROTOCOL_VERSION, id: newMessageId(), type: 'interrupt', payload: {} };
    send(message);
  }, [send]);

  const respond = useCallback(
    (response: ApprovalResponsePayload): void => {
      // The modal closes as the answer goes out; the server parks nothing back.
      setView((current) => dismissApproval(current, response.requestId));
      const message: ClientMessage = {
        v: PROTOCOL_VERSION,
        id: newMessageId(),
        type: 'approval_response',
        payload: response,
      };
      send(message);
    },
    [send],
  );

  const dismissError = useCallback((): void => {
    setView(clearError);
  }, []);

  return { view, connection, sendPrompt, interrupt, respond, dismissError };
}

/** Unique per frame; the protocol only asks that a `ClientMessage` carry one. */
let idCounter = 0;
function newMessageId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * The socket URL is resolved against the page, so the Vite dev proxy carries it
 * (`ws: true` on `/ws`) and production needs no host baked in — only the
 * scheme changes for a TLS page.
 */
function socketUrl(projectId: string): string {
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('projectId', projectId);
  return url.toString();
}

function nextBackoff(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/**
 * The contract is compile-time; the wire is not. One guard at the boundary
 * drops a frame that is not a `ServerEvent` of the protocol we speak, instead
 * of folding garbage into the view.
 */
function parseServerEvent(data: unknown): ServerEvent | null {
  if (typeof data !== 'string') return null;

  let body: unknown;
  try {
    body = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (typeof body !== 'object' || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (candidate['v'] !== PROTOCOL_VERSION) return null;
  if (typeof candidate['seq'] !== 'number' || typeof candidate['ts'] !== 'string') return null;
  if (typeof candidate['kind'] !== 'string') return null;

  return body as ServerEvent;
}
