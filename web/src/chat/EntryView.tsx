import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import type { ChatEntry, ToolEntry, ToolResultView } from './reducer';

/**
 * The one transcript renderer. A live chat entry and a stored history entry are
 * the same view-model shape (see `reducer.ts`), so both the streaming
 * `ChatPanel` and the read-only `SessionHistory` transcript render through here
 * — the point of the shared `ContentBlock` mirror is that there is exactly one
 * renderer, not two that drift (spec-02 §"Session history & resume (REST)").
 *
 * The live bubble lives here for that same reason (ticket 51): its head and a
 * settled assistant entry's are one component rather than two that agree today,
 * which is the only version of "the same head" a switch between them can keep.
 */

export function EntryView({ entry }: { entry: ChatEntry }): ReactElement {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] tracking-wider text-ink-dim uppercase">You</span>
          <p className="max-w-[85%] rounded-lg bg-bg-3 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
            {entry.text}
          </p>
        </div>
      );
    case 'assistant':
      return <AssistantMessage>{entry.text}</AssistantMessage>;
    case 'thinking':
      // Collapsible: reasoning is available but does not dominate the transcript.
      return (
        <details className="rounded border border-line bg-panel/60 px-3 py-2">
          <summary className="cursor-pointer text-[11px] tracking-wider text-ink-dim uppercase">Thinking</summary>
          <p className="mt-2 text-xs whitespace-pre-wrap text-ink-dim">{entry.text}</p>
        </details>
      );
    case 'notice':
      return <p className="text-center text-[11px] tracking-wider text-ink-dim uppercase">{entry.text}</p>;
    case 'tool':
      return <ToolCard entry={entry} />;
  }
}

/**
 * An assistant message: the tile at its head, its text beside it.
 *
 * Every assistant message wears the tile — a live one and a stored one, both of
 * which come through here — and only the assistant's *own text* does. A tool
 * card, a thinking block and a notice go without: they belong to the message
 * above them. The prototype hangs the avatar on `turn-assistant` and nothing
 * else (`common.js:207-209`), but our transcript lists *entries*, not turns, and
 * a turn is not a node we render — so the assistant's text is the closest thing
 * this view model has to the prototype's turn, and "why is there no tile on the
 * tool card?" is answered by that: a card is not a speaker.
 *
 * `className` is the caller's own spacing; every other part of the head is here,
 * so the two callers cannot drift apart.
 */
function AssistantMessage({ children, className = '' }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <AssistantTile />
      <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap text-ink">{children}</p>
    </div>
  );
}

/**
 * The prototype's `.avatar` (`styles.css:113-118`) with its mark (`ICONS.logo`,
 * `common.js:34`), at `150deg` — the angle the prototype's own gradient is drawn
 * at, which the palette comment in `index.css` quotes for the same reason. Fixed
 * size and `shrink-0`, so a long message does not stretch it.
 *
 * Decorative: `aria-hidden`, no text inside, and it changes nothing a screen
 * reader reads — "assistant" is a fact about who is speaking, and the message's
 * own wording already carries everything that has to be announced. The user
 * turn's `You` label is the one that speaks, and it stays as it is.
 *
 * `data-assistant-tile` is the handle the rendered test aims at, as
 * `data-chat-column` is ticket 50's.
 */
function AssistantTile(): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-assistant-tile=""
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-linear-[150deg] from-accent to-accent-deep text-white"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" />
      </svg>
    </span>
  );
}

/**
 * The assistant message being written. It wears the same head — the same
 * component, not a look-alike — because the live text and the settled entry are
 * two different elements: a tile added to the entry alone would appear for the
 * first time the moment a turn finished.
 */
export function StreamingBubble({ text }: { text: string }): ReactElement {
  return (
    <AssistantMessage className="mt-3">
      {text}
      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
    </AssistantMessage>
  );
}

/** Where a tool call stands — derived from the entry, never stored on it. */
type ToolStatus = 'running' | 'done' | 'error';

/** The only place the entry's own shape is read as a status. */
function toolStatus(entry: ToolEntry): ToolStatus {
  if (entry.result === null) return 'running';
  return entry.result.isError ? 'error' : 'done';
}

/** The card's disclosure chrome, shared so the two bodies cannot drift apart. */
const DISCLOSURE = 'border-t border-line px-3 py-2';
const DISCLOSURE_SUMMARY = 'cursor-pointer text-[10px] tracking-wider uppercase';

function ToolCard({ entry }: { entry: ToolEntry }): ReactElement {
  const status = toolStatus(entry);

  // Ticket 49: the card is a surface of its own, not the sidebar's — its body on
  // the first step of the scale and its head on the next, which is what makes a
  // finished call read as one object instead of a hairline box.
  return (
    <div className="rounded border border-line bg-bg-1">
      <div className="flex items-center gap-2 bg-bg-2 px-3 py-2">
        <span className="font-mono text-xs text-accent">{entry.name}</span>
        <span className="truncate font-mono text-[10px] text-ink-dim">{summarizeInput(entry.input)}</span>
        <ToolStatusBadge status={status} />
      </div>

      <details className={DISCLOSURE}>
        <summary className={`${DISCLOSURE_SUMMARY} text-ink-dim`}>Input</summary>
        <pre className="mt-1 max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
          {formatInput(entry.input)}
        </pre>
      </details>

      {entry.result !== null && (
        <ToolResultDisclosure status={status} result={entry.result} toolUseId={entry.toolUseId} />
      )}

      {entry.children.length > 0 && (
        <ol className="ml-3 flex flex-col gap-3 border-l border-line px-3 py-2">
          {entry.children.map((child, index) => (
            <li key={index}>
              <EntryView entry={child} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The result body. It opens itself the moment the card has a result, so a
 * finished call is readable without a click — and the reader can still collapse
 * it, because the ref records which tool it auto-opened for: a streaming
 * transcript re-renders constantly and would otherwise re-open the body under
 * the reader's cursor. Keyed by tool id rather than "first render" so a card
 * reused for a different entry (the transcript lists by index) opens for that
 * one too.
 */
function ToolResultDisclosure({
  toolUseId,
  status,
  result,
}: {
  toolUseId: string;
  /** Never `running`: this body only exists once the call has a result. */
  status: ToolStatus;
  result: ToolResultView;
}): ReactElement {
  const details = useRef<HTMLDetailsElement>(null);
  const openedFor = useRef<string | null>(null);
  const failed = status === 'error';

  useEffect(() => {
    if (details.current === null || openedFor.current === toolUseId) return;
    openedFor.current = toolUseId;
    details.current.open = true;
  }, [toolUseId]);

  return (
    <details ref={details} className={DISCLOSURE}>
      <summary className={`${DISCLOSURE_SUMMARY} ${failed ? 'text-err' : 'text-ink-dim'}`}>
        {failed ? 'Error' : 'Result'}
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
        {formatContent(result.content)}
      </pre>
    </details>
  );
}

/**
 * The card's status word. `running…` wears the prototype's chip so an unfinished
 * call is legible at a glance; `done` and `error` are bare words in the palette
 * tokens, `done`'s accent being the one ticket 37's toasts share.
 */
function ToolStatusBadge({ status }: { status: ToolStatus }): ReactElement {
  switch (status) {
    case 'running':
      return (
        <span className="ml-auto shrink-0 rounded-full bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
          running…
        </span>
      );
    case 'done':
      return <span className="ml-auto shrink-0 font-mono text-[10px] text-ok">done</span>;
    case 'error':
      return <span className="ml-auto shrink-0 font-mono text-[10px] text-err">error</span>;
  }
}

/** A one-line gist for the tool card header — falls back to the JSON. */
function summarizeInput(input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>;
    for (const key of ['command', 'file_path', 'pattern', 'path', 'description']) {
      const value = record[key];
      if (typeof value === 'string') return value;
    }
  }
  return '';
}

export function formatInput(input: unknown): string {
  if (typeof input === 'string') return input;
  return safeStringify(input);
}

/** Tool results arrive as a string or a block array — render either legibly. */
function formatContent(content: unknown): string {
  if (typeof content === 'string') return content;
  return safeStringify(content);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
