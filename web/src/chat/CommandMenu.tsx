import type { SlashCommand } from '@clodeck/shared';
import type { ReactElement } from 'react';

/**
 * The `/` menu: what the composer offers once a slash begins the box.
 *
 * It is the *list* alone — which commands, which one is highlighted, what a
 * click chooses. It holds no state and reads no keyboard: both of those belong
 * to the box, because they are what the line under the box documents and the
 * two have to stay one thing (`Composer.tsx`). This is why the panel can be
 * rendered from a plain array in a test.
 *
 * A row prints what the command's file said, and nothing it did not: the name,
 * the argument hint, the description, each only when the source declared one.
 * Showing a command without a description is not a hole in the row — inventing
 * one to fill it would be.
 */
export function CommandMenu({
  commands,
  highlight,
  onChoose,
}: {
  commands: readonly SlashCommand[];
  /** The row Enter would choose: an index into `commands`, already clamped by the caller. */
  highlight: number;
  onChoose: (command: SlashCommand) => void;
}): ReactElement {
  return (
    <ul
      role="listbox"
      aria-label="Commands"
      // Above the box, full width, and scrolling once it is longer than the
      // transcript it covers: a list of every built-in is long.
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded border border-line bg-panel py-1 shadow-lg"
    >
      {commands.length === 0 ? (
        // The panel stays open with nothing in it rather than vanishing: the
        // user typed a slash, and an empty list that disappears leaves them
        // wondering whether the app saw it. Enter is still the ordinary send.
        <li className="px-3 py-1.5 text-[11px] text-ink-dim">no matching command</li>
      ) : (
        commands.map((command, index) => (
          <li
            key={command.name}
            role="option"
            aria-selected={index === highlight}
            title={command.description}
            // The box keeps the caret: the menu answers the keyboard, and a
            // click that moved focus out of the textarea would end that.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onChoose(command);
            }}
            className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-xs ${
              index === highlight ? 'bg-white/5' : ''
            }`}
          >
            <span className="shrink-0 font-mono text-accent">/{command.name}</span>
            {command.argumentHint !== undefined && (
              <span className="shrink-0 text-ink-dim">{command.argumentHint}</span>
            )}
            {command.description !== undefined && (
              <span className="truncate text-ink-dim">{command.description}</span>
            )}
          </li>
        ))
      )}
    </ul>
  );
}

/**
 * The rows a query offers: **substring**, case-insensitively, over the name —
 * not a prefix, because a name is remembered by whatever part of it stuck, and
 * `/review` reaching `code-review` is the menu working rather than a
 * coincidence.
 *
 * Alphabetical, because a menu is scanned: the order a list arrived in is the
 * SDK's business or a directory's, and neither is an order anybody reads.
 */
export function matchingCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.toLowerCase();
  return commands
    .filter((command) => command.name.toLowerCase().includes(needle))
    .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()));
}
