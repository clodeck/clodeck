// @vitest-environment jsdom
import type { SlashCommand } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

/**
 * The prompt box's contracts: it grows with what is typed and stops at a
 * ceiling, the line under it tells the truth about the keyboard, and a `/` opens
 * the session's commands (ticket 75) — filtered as the user types, inserted
 * without sending, and chosen with the keys the hint names.
 *
 * jsdom lays nothing out, so `scrollHeight` — the number the box grows by — is
 * always 0. The stub below is a *model* of layout (a line height, a two-row
 * floor, the box's padding) read off the textarea's own value, so the assertions
 * stay about the composer's use of a measurement — grow, stop, collapse —
 * instead of about a number jsdom invented.
 *
 * jsdom does not move a caret when a controlled input's value is re-set the way
 * `fireEvent.change` does, so `type()` puts it where a real box would: after
 * what was typed. The menu reads the caret, so a test that skipped this would be
 * testing a box nobody has.
 */

/** The model's line box: every expected pixel height below is derived from it. */
const LINE_HEIGHT = 18;
const PADDING = 16;
const MIN_ROWS = 2;

const EMPTY = PADDING + MIN_ROWS * LINE_HEIGHT; // 52
const THREE_LINES = PADDING + 3 * LINE_HEIGHT; // 70

function measuring(textarea: HTMLTextAreaElement): void {
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    get: () => PADDING + Math.max(MIN_ROWS, textarea.value.split('\n').length) * LINE_HEIGHT,
  });
}

/** Three commands, so every row state the menu draws is one of them. */
const COMMANDS: readonly SlashCommand[] = [
  // Both words: the row shows the name, the hint and the description.
  { name: 'code-review', description: 'Review the diff.', argumentHint: '[low|high]' },
  // Neither: the row is its name, and nothing is invented to fill it.
  { name: 'ask-matt' },
  { name: 'verifier', description: 'Verify the change.' },
];

interface Rendered {
  box: HTMLTextAreaElement;
  onSend: ReturnType<typeof vi.fn>;
  onMenuOpen: ReturnType<typeof vi.fn>;
}

function renderComposer(
  options: { disabled?: boolean; commands?: readonly SlashCommand[] } = {},
): Rendered {
  const onSend = vi.fn();
  const onMenuOpen = vi.fn();
  render(
    <Composer
      onSend={onSend}
      disabled={options.disabled ?? false}
      commands={options.commands ?? []}
      onMenuOpen={onMenuOpen}
    />,
  );
  const box = screen.getByLabelText('Message');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('the composer has no textarea');
  measuring(box);
  return { box, onSend, onMenuOpen };
}

/**
 * A keystroke: the value the box now holds, and the caret a real one would have
 * left after it. `caret` is for the edits that are not at the end — typing into
 * the middle of a slash token, or a click back into it.
 */
function type(box: HTMLTextAreaElement, value: string, caret = value.length): void {
  fireEvent.change(box, { target: { value } });
  box.setSelectionRange(caret, caret);
  fireEvent.select(box);
}

/** The rows the menu is currently drawing, by their names. */
function rows(): string[] {
  return screen
    .getAllByRole('option')
    .map((row) => row.querySelector('span')?.textContent ?? '');
}

/** The row the highlight is on, as the menu itself marks it. */
function highlighted(): string | null {
  const selected = screen.queryAllByRole('option').filter((row) => row.getAttribute('aria-selected') === 'true');
  return selected[0]?.querySelector('span')?.textContent ?? null;
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
});

describe('the composer', () => {
  it('grows with the content, stops at the ceiling, and collapses when it sends', () => {
    const { box, onSend } = renderComposer();

    fireEvent.change(box, { target: { value: 'one\ntwo\nthree' } });
    expect(box.style.height).toBe(`${String(THREE_LINES)}px`);

    // Twenty lines measure 376px; the box stops at 160 and scrolls instead.
    fireEvent.change(box, { target: { value: Array.from({ length: 20 }, () => 'x').join('\n') } });
    expect(box.style.height).toBe('160px');

    // Sending empties the box and returns it to its floor — not to 160px.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith(Array.from({ length: 20 }, () => 'x').join('\n'));
    expect(box.value).toBe('');
    expect(box.style.height).toBe(`${String(EMPTY)}px`);
  });

  it('says what the keyboard does, in both states, and does not lie about it', () => {
    const { box, onSend } = renderComposer();
    expect(screen.getByText('Enter to send · Shift+Enter for a newline')).toBeTruthy();

    // The hint is documentation of the handling below it: check both halves.
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello');

    // The connecting state — the box cannot send yet, and its placeholder says
    // so — keeps the hint, because the keys below it are not what changed.
    cleanup();
    renderComposer({ disabled: true });
    expect(screen.getByPlaceholderText('Connecting…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Enter to send · Shift+Enter for a newline')).toBeTruthy();
  });
});

describe('the command menu', () => {
  it('opens on a leading slash with the whole list, and asks for a fresh one', () => {
    const { box, onMenuOpen } = renderComposer({ commands: COMMANDS });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onMenuOpen).not.toHaveBeenCalled();

    type(box, '/');

    // Alphabetical, with nothing filtered out: the list is the whole offer.
    expect(rows()).toEqual(['/ask-matt', '/code-review', '/verifier']);
    // Opening is the moment the list is worth re-reading, so the panel hears it.
    expect(onMenuOpen).toHaveBeenCalledTimes(1);
  });

  it('filters by substring, case-insensitively, as the user types', () => {
    const { box } = renderComposer({ commands: COMMANDS });
    type(box, '/');

    // Not a prefix match: `REV` is the middle of `code-review`.
    type(box, '/REV');
    expect(rows()).toEqual(['/code-review']);
  });

  it('stays shut when the slash is not the first token', () => {
    const { box } = renderComposer({ commands: COMMANDS });

    type(box, 'tell me about /');
    expect(screen.queryByRole('listbox')).toBeNull();

    // …and shuts again once the caret leaves the first word, because a command
    // is dispatched from that word alone.
    type(box, '/code-review ');
    expect(screen.queryByRole('listbox')).toBeNull();

    type(box, '/co hello', 3);
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  it('does not open at all while the chat is not live', () => {
    // A menu that chose a command nothing could send would be the worst kind of
    // "why does this not work" — the box is disabled for the same reason.
    const { box, onMenuOpen } = renderComposer({ commands: COMMANDS, disabled: true });

    type(box, '/');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onMenuOpen).not.toHaveBeenCalled();
  });

  it('shows what each command declared, and nothing it did not', () => {
    const { box } = renderComposer({ commands: COMMANDS });
    type(box, '/');

    const full = screen.getByRole('option', { name: /code-review/ });
    expect(within(full).getByText('/code-review')).toBeTruthy();
    expect(within(full).getByText('[low|high]')).toBeTruthy();
    expect(within(full).getByText('Review the diff.')).toBeTruthy();

    // A command whose file declares neither is its name alone: no blank
    // description, no placeholder invented to fill the row.
    const bare = screen.getByRole('option', { name: '/ask-matt' });
    expect(bare.textContent).toBe('/ask-matt');
  });

  it('inserts the command into the box on Enter, and does not send', () => {
    const { box, onSend } = renderComposer({ commands: COMMANDS });
    type(box, '/ver');

    fireEvent.keyDown(box, { key: 'Enter' });

    expect(box.value).toBe('/verifier ');
    // After the space, where the command's argument is typed.
    expect(box.selectionStart).toBe('/verifier '.length);
    // The whole point of the menu: a command with no argument is meaningless, so
    // this writes it and stops.
    expect(onSend).not.toHaveBeenCalled();
    // Chosen is chosen: the panel is out of the way.
    expect(screen.queryByRole('listbox')).toBeNull();
    // And the hint is back to the box's ordinary one.
    expect(screen.getByText('Enter to send · Shift+Enter for a newline')).toBeTruthy();
  });

  it('inserts on a click and on Tab too, keeping what was typed after the token', () => {
    const { box, onSend } = renderComposer({ commands: COMMANDS });
    type(box, '/code-review hello', 4);

    fireEvent.click(screen.getByRole('option', { name: /code-review/ }));
    expect(box.value).toBe('/code-review hello');
    expect(onSend).not.toHaveBeenCalled();

    cleanup();
    const second = renderComposer({ commands: COMMANDS });
    type(second.box, '/ver');
    fireEvent.keyDown(second.box, { key: 'Tab' });
    expect(second.box.value).toBe('/verifier ');
    expect(second.onSend).not.toHaveBeenCalled();
  });

  it('moves the highlight with the arrow keys, wrapping, and Enter takes the lit row', () => {
    const { box, onSend } = renderComposer({ commands: COMMANDS });
    type(box, '/');
    expect(highlighted()).toBe('/ask-matt');

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(highlighted()).toBe('/code-review');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    // Up from the first row is the last one: a list of three is not a scroll.
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(highlighted()).toBe('/verifier');

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('/verifier ');
    expect(onSend).not.toHaveBeenCalled();

    // A new query is a new question, so the highlight starts at the top again.
    type(box, '/', 1);
    expect(highlighted()).toBe('/ask-matt');
  });

  it('closes on Escape without touching what was typed', () => {
    const { box } = renderComposer({ commands: COMMANDS });
    type(box, '/ver');
    expect(screen.queryByRole('listbox')).not.toBeNull();

    fireEvent.keyDown(box, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box.value).toBe('/ver');
    // Dismissed for this token, not forever: clearing the box is a new `/`.
    type(box, '');
    type(box, '/ver');
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });

  it('keeps the panel open with nothing in it, and lets Enter send', () => {
    const { box, onSend } = renderComposer({ commands: COMMANDS });
    type(box, '/zzz');

    // Still open, saying so — a panel that vanished would leave the user
    // wondering whether the app saw the slash at all.
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByText('no matching command')).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
    // Nothing is highlighted, so the hint does not claim a row can be chosen.
    expect(screen.getByText('Enter to send · Esc to close')).toBeTruthy();

    fireEvent.keyDown(box, { key: 'Enter' });

    // Nothing to choose, so Enter is the ordinary send — the box empties and the
    // menu goes with the slash that opened it.
    expect(onSend).toHaveBeenCalledWith('/zzz');
    expect(box.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on an empty list as "no matching command" rather than not at all', () => {
    // The state a project that declares nothing at all is in: an empty list is
    // still a list, so the panel appears and says so — it is not an error, and
    // not a menu that silently failed to open.
    const { box } = renderComposer({ commands: [] });
    type(box, '/');

    expect(screen.getByText('no matching command')).toBeTruthy();
  });
});
