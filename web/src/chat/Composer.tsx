import type { SlashCommand } from '@clodeck/shared';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { CommandMenu, matchingCommands } from './CommandMenu';

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
 *
 * Since ticket 75 the box also offers the session's commands. `/` as the first
 * token opens a list of them (the panel is `CommandMenu.tsx`), typing filters
 * it, and choosing one writes `/name ` into the box **without sending**: a
 * command's argument is the user's to type. That is why the keyboard and the
 * hint are still one file — with the panel open, Enter chooses a row instead of
 * sending, and the line under the box says so.
 */

/** The composer's ceiling in px (`max-height: 160px` in the prototype). */
const MAX_HEIGHT = 160;

export function Composer({
  onSend,
  disabled,
  commands,
  onMenuOpen,
}: {
  onSend: (prompt: string) => void;
  disabled: boolean;
  /** The commands `/` may offer — the run's own list, or the project's files. */
  commands: readonly SlashCommand[];
  /**
   * The menu is being opened, so the list is worth re-reading: a skill installed
   * while this chat was open is a command nobody has told the client about.
   */
  onMenuOpen: () => void;
}): ReactElement {
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const canSend = value.trim() !== '' && !disabled;

  /**
   * The token the caret is in, up to the caret. A command is dispatched from the
   * prompt's **first** word alone, so a menu that opened anywhere else would
   * offer a `/name` this box cannot run — and one that stayed open after the
   * caret left the word would be the same lie one keystroke later.
   */
  const prefix = value.slice(0, caret);
  const slash = isCommandPrefix(prefix);
  const menuOpen = slash && !dismissed && !disabled;
  const matching = menuOpen ? matchingCommands(commands, prefix.slice(1)) : [];
  /** The row Enter would choose: the stored index, kept inside the list it points at. */
  const active = Math.max(0, Math.min(highlight, matching.length - 1));

  // Grow to fit, never past the ceiling. `auto` first, deliberately: the height
  // from the previous value would be the floor the browser measures against, so
  // deleting a line would leave the box as tall as it had grown.
  useEffect(() => {
    const textarea = box.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, MAX_HEIGHT))}px`;
  }, [value]);

  // Every change to what is being typed is a new question: the highlight goes
  // back to the first row, and an `Esc` is forgotten once the box stops reading
  // as a command at all — that is what makes it a dismissal of *this* `/` rather
  // than of the menu for the rest of the prompt.
  useEffect(() => {
    setHighlight(0);
    if (!isCommandPrefix(prefix)) setDismissed(false);
  }, [prefix]);

  useEffect(() => {
    if (menuOpen) onMenuOpen();
  }, [menuOpen, onMenuOpen]);

  const submit = (): void => {
    if (!canSend) return;
    onSend(value);
    // Emptying the value is also what returns the box to its minimum: the
    // measurement above runs again for the empty box.
    setValue('');
  };

  /**
   * Writes the command in place of the token being completed and leaves the
   * caret after it — in the box, which keeps the focus it never lost. It
   * deliberately does **not** send: `/ask-matt` with no argument is meaningless,
   * and this box is a chat input whose Enter sends. The menu is a way of typing,
   * not a second meaning for the key.
   */
  const choose = (command: SlashCommand): void => {
    const completed = complete(value, command.name);
    setValue(completed.value);
    setCaret(completed.caret);
    box.current?.focus();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="relative flex flex-col gap-1"
    >
      {menuOpen && <CommandMenu commands={matching} highlight={active} onChoose={choose} />}
      <div className="flex items-end gap-2">
        {/* Ticket 49: the box is the chat's one input, so it takes the level the
            prototype gives it (`.composer-box`, `styles.css:156-160`) and reads
            as a raised field rather than a rectangle drawn on the page. */}
        <textarea
          ref={box}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          // A *caret move* with no change to the text: a click into the middle of
          // the box, an arrow key out of the first word. The menu follows the
          // token the caret is in, so both ends of that are followed.
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
          }}
          onKeyDown={(event) => {
            if (menuOpen && event.key === 'Escape') {
              event.preventDefault();
              setDismissed(true);
              return;
            }
            if (menuOpen && matching.length > 0) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                // The highlight moves, the caret does not: they are two cursors,
                // and only one of them is choosing a command.
                event.preventDefault();
                setHighlight(step(active, event.key === 'ArrowDown' ? 1 : -1, matching.length));
                return;
              }
              // Enter and Tab both take the highlighted row. With no row to take
              // neither is intercepted, so Enter is the ordinary send below.
              if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                event.preventDefault();
                const command = matching[active];
                if (command !== undefined) choose(command);
                return;
              }
            }
            // Enter sends; Shift+Enter is a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={disabled ? 'Connecting…' : 'Ask Claude…'}
          aria-label="Message"
          className="min-h-0 max-h-40 flex-1 resize-none rounded border border-line bg-bg-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
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
      <p className="text-[11px] text-ink-dim">{hintFor(menuOpen, matching.length)}</p>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* The command token                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Whether a prefix is a command being typed: it opens with `/` and holds no
 * whitespace. Both halves come from the same fact — the SDK dispatches a command
 * from the prompt's first word — so a `/` in the middle of a sentence opens
 * nothing, and a first word the caret has already left stops being one.
 */
function isCommandPrefix(prefix: string): boolean {
  return prefix.startsWith('/') && !/\s/.test(prefix);
}

/**
 * The box with `name`'s command inserted, and where the caret goes: `/name ` in
 * place of the token being completed — the whole first word, so what was typed
 * after it survives — and the caret after the space, where the command's
 * argument is typed.
 */
function complete(value: string, name: string): { value: string; caret: number } {
  const inserted = `/${name} `;
  const rest = value.slice(tokenEnd(value)).replace(/^\s+/, '');
  return { value: `${inserted}${rest}`, caret: inserted.length };
}

/** Where the box's first token ends: at the first whitespace, or at the box's own end. */
function tokenEnd(value: string): number {
  const end = value.search(/\s/);
  return end === -1 ? value.length : end;
}

/** The next highlighted row, wrapping at both ends: a list of five is not a scroll. */
function step(current: number, by: number, length: number): number {
  return (current + by + length) % length;
}

/**
 * What the line under the box says, as one function of one state — because the
 * two cannot be allowed to disagree. With the menu open, "Enter to send" is a
 * lie: Enter takes the highlighted command. With the menu open and nothing
 * matching, it is true again, and the line says so along with the one key that
 * still does something (`Esc`), while the panel above carries the "no matching
 * command" itself.
 */
function hintFor(menuOpen: boolean, matches: number): string {
  if (!menuOpen) return 'Enter to send · Shift+Enter for a newline';
  return matches === 0
    ? 'Enter to send · Esc to close'
    : '↑↓ to choose · Enter or Tab to insert · Esc to close';
}
