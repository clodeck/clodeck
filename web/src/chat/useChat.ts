import {
  PROTOCOL_VERSION,
  type ApprovalResponsePayload,
  type ClientMessage,
  type PermissionMode,
  type Project,
  type ResumePayload,
  type ServerEvent,
} from '@clodeck/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyServerEvent,
  clearError,
  dismissApproval,
  emptyView,
  withPermissionMode,
  withResumeTarget,
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
  /**
   * Send a prompt on `profile` — the name the picker chose, or the reserved
   * `default` when nothing was remembered — and under `permissionMode`, the
   * mode the chip is showing. Both ride the frame rather than a second control
   * message: they are properties of *this* turn, and the server resolves them
   * as the run starts (spec-08 §"The run carries a provider"; ticket 82).
   */
  sendPrompt: (prompt: string, profile: string, permissionMode: PermissionMode) => void;
  /**
   * Choose the mode this session runs under. A mid-turn choice is sent at once
   * (`set_permission_mode`) and applies to the rest of the turn; an idle one is
   * remembered here and rides the next `send_prompt`, so the mode and the
   * prompt leave together and there is no frame for a turn that does not exist.
   */
  setPermissionMode: (mode: PermissionMode) => void;
  interrupt: () => void;
  /** Answers the approval modal (Allow/Deny only for the MVP). */
  respond: (response: ApprovalResponsePayload) => void;
  /**
   * Arms the next `send_prompt` to resume from `target` — by id (optionally
   * forked) or the latest session. Sends no prompt of its own (spec-02
   * §"Turn lifecycle"): the resumed turn starts on the next send.
   */
  resume: (target: ResumePayload) => void;
  /**
   * Drop the chat and start another one — the only way out of a session once it
   * has run. The client's half is its whole live state; the server's half is a
   * `clear_resume` frame, which drops the armed target and the buffered
   * transcript a reconnect would otherwise rebuild from. Neither half creates
   * anything: the next session comes into being on the next send, which is the
   * only thing that can write one to disk at all.
   *
   * Nothing happens at all if that frame cannot go out: the surface offers this
   * only while the chat is live (the composer's own rule), and the check here is
   * what keeps a socket that closed between the render and the click from
   * clearing half of a chat.
   */
  newChat: () => void;
  dismissError: () => void;
}

/** First retry delay; doubles per attempt up to {@link MAX_BACKOFF_MS}. */
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

export function useChat(project: Project): ChatController {
  const [view, setView] = useState<ChatView>(emptyView);
  const [connection, setConnection] = useState<ChatConnection>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  // The mode choice is made from a click handler that outlives the render it
  // was attached to, so whether the run is live is read from the latest view
  // rather than from a callback's stale closure.
  const running = useRef(false);
  running.current = view.state !== 'idle';

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

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const sendPrompt = useCallback(
    (prompt: string, profile: string, permissionMode: PermissionMode): void => {
      const trimmed = prompt.trim();
      if (trimmed === '') return;
      // Shown at once; the fold drops the bus's echo if one arrives.
      setView((current) => withUserPrompt(current, trimmed));
      send(
        clientMessage({
          type: 'send_prompt',
          payload: { prompt: trimmed, profile, permissionMode },
        }),
      );
    },
    [send],
  );

  const setPermissionMode = useCallback(
    (mode: PermissionMode): void => {
      setView((current) => withPermissionMode(current, mode));
      // A live run is told now: the switch governs its remaining tool requests.
      // An idle project has no run to tell — the next send carries the choice
      // with the prompt, which is also what keeps it from racing a turn start.
      if (running.current) {
        send(clientMessage({ type: 'set_permission_mode', payload: { mode } }));
      }
    },
    [send],
  );

  const interrupt = useCallback((): void => {
    send(clientMessage({ type: 'interrupt', payload: {} }));
  }, [send]);

  const respond = useCallback(
    (response: ApprovalResponsePayload): void => {
      // The modal closes as the answer goes out; the server parks nothing back.
      setView((current) => dismissApproval(current, response.requestId));
      send(clientMessage({ type: 'approval_response', payload: response }));
    },
    [send],
  );

  const dismissError = useCallback((): void => {
    setView(clearError);
  }, []);

  const resume = useCallback(
    (target: ResumePayload): void => {
      // Shown at once so the next send is not a surprise; the bus holds the same
      // target and clears it as the turn starts (reducer's `turn_started`).
      setView((current) => withResumeTarget(current, target));
      send(clientMessage({ type: 'resume', payload: target }));
    },
    [send],
  );

  const newChat = useCallback((): void => {
    // The frame goes first and the view is cleared only once it is away: the two
    // halves are one act, and a surface that emptied itself while the bus kept the
    // old target and transcript would be showing a new chat that the next
    // reconnect takes straight back.
    if (!send(clientMessage({ type: 'clear_resume', payload: {} }))) return;
    setView(emptyView());
  }, [send]);

  return {
    view,
    connection,
    sendPrompt,
    setPermissionMode,
    interrupt,
    respond,
    resume,
    newChat,
    dismissError,
  };
}

/**
 * One member of `ClientMessage` with its envelope fields removed. The conditional
 * is what distributes the transform over the union; a plain `Omit` would collapse
 * every member into one uncorrelated shape and lose the `type`/`payload` pairing.
 */
type WithoutEnvelope<Member> = Member extends { type: unknown } ? Omit<Member, 'v' | 'id'> : never;

/** A frame before the transport stamps its envelope: `v` and `id` are not yet set. */
type OutgoingMessage = WithoutEnvelope<ClientMessage>;

/**
 * Stamps the two fields every frame carries, so no call site hand-builds the
 * envelope. Typed against {@link OutgoingMessage}, the discriminant still binds
 * `type` to its payload: the wrong payload for a `type`, or an unknown field, is
 * the same compile error it was when each message was built by hand.
 */
function clientMessage(message: OutgoingMessage): ClientMessage {
  return { ...message, v: PROTOCOL_VERSION, id: newMessageId() };
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
