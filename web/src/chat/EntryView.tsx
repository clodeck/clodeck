import { useEffect, useRef, type ReactElement } from 'react';

import type { ChatEntry, ToolEntry, ToolResultView } from './reducer';

/**
 * The one transcript renderer. A live chat entry and a stored history entry are
 * the same view-model shape (see `reducer.ts`), so both the streaming
 * `ChatPanel` and the read-only `SessionHistory` transcript render through here
 * — the point of the shared `ContentBlock` mirror is that there is exactly one
 * renderer, not two that drift (spec-02 §"Session history & resume (REST)").
 */

export function EntryView({ entry }: { entry: ChatEntry }): ReactElement {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] tracking-wider text-ink-dim uppercase">You</span>
          <p className="max-w-[85%] rounded-lg bg-white/10 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
            {entry.text}
          </p>
        </div>
      );
    case 'assistant':
      return <p className="text-sm whitespace-pre-wrap text-ink">{entry.text}</p>;
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

/** Where a tool call stands — derived from the entry, never stored on it. */
export type ToolStatus = 'running' | 'done' | 'error';

export function toolStatus(entry: ToolEntry): ToolStatus {
  if (entry.result === null) return 'running';
  return entry.result.isError ? 'error' : 'done';
}

function ToolCard({ entry }: { entry: ToolEntry }): ReactElement {
  return (
    <div className="rounded border border-line bg-panel">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="font-mono text-xs text-accent">{entry.name}</span>
        <span className="truncate font-mono text-[10px] text-ink-dim">{summarizeInput(entry.input)}</span>
        <ToolStatusBadge status={toolStatus(entry)} />
      </div>

      <details className="border-t border-line px-3 py-2">
        <summary className="cursor-pointer text-[10px] tracking-wider text-ink-dim uppercase">Input</summary>
        <pre className="mt-1 max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
          {formatInput(entry.input)}
        </pre>
      </details>

      {entry.result !== null && (
        <ToolResultDisclosure toolUseId={entry.toolUseId} result={entry.result} />
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
  result,
}: {
  toolUseId: string;
  result: ToolResultView;
}): ReactElement {
  const details = useRef<HTMLDetailsElement>(null);
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    if (details.current === null || openedFor.current === toolUseId) return;
    openedFor.current = toolUseId;
    details.current.open = true;
  }, [toolUseId]);

  return (
    <details ref={details} className="border-t border-line px-3 py-2">
      <summary
        className={`cursor-pointer text-[10px] tracking-wider uppercase ${result.isError ? 'text-err' : 'text-ink-dim'}`}
      >
        {result.isError ? 'Error' : 'Result'}
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-dim">
        {formatContent(result.content)}
      </pre>
    </details>
  );
}

/** The card's status word: in-progress, the new success token, or today's error red. */
function ToolStatusBadge({ status }: { status: ToolStatus }): ReactElement {
  switch (status) {
    case 'running':
      return <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-dim">running…</span>;
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
