import { useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * The prompt box — the transcript's one input, and the only keyboard shortcut in
 * the chat (Enter sends, Shift+Enter is a newline). It is its own file because it
 * is the one piece of `ChatPanel` with a life of its own: hidden state, a
 * measurement, and a line of documentation under it.
 *
 * The box grows with its content and stops at a ceiling, then scrolls, which is
 * the prototype's behaviour (`common.js:216-241`, `styles.css:153-173`): the
 * textarea is `resize-none` — no manual handle — and every value change
 * re-measures it. The hint under the composer is *documentation*, not a second
 * implementation of the key handling: they live together so the hint cannot
 * drift from what the box does.
 */

/** The composer's ceiling in px (`max-height: 160px` in the prototype). */
const MAX_HEIGHT = 160;

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (prompt: string) => void;
  disabled: boolean;
}): ReactElement {
  const [value, setValue] = useState('');
  const box = useRef<HTMLTextAreaElement | null>(null);
  const canSend = value.trim() !== '' && !disabled;

  // Grow to fit, never past the ceiling. `auto` first, deliberately: the height
  // from the previous value would be the floor the browser measures against, so
  // deleting a line would leave the box as tall as it had grown.
  useEffect(() => {
    const textarea = box.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, MAX_HEIGHT))}px`;
  }, [value]);

  const submit = (): void => {
    if (!canSend) return;
    onSend(value);
    // Emptying the value is also what returns the box to its minimum: the
    // measurement above runs again for the empty box.
    setValue('');
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={disabled ? 'Connecting…' : 'Ask Claude…'}
          aria-label="Message"
          className="min-h-0 max-h-40 flex-1 resize-none rounded border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="rounded bg-accent px-3 py-2 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {/* Present in every state, including the connecting one: the keys below it
          are wired regardless of whether the box can send yet. */}
      <p className="text-[11px] text-ink-dim">Enter to send · Shift+Enter for a newline</p>
    </form>
  );
}
