// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';

/**
 * The prompt box's two contracts: it grows with what is typed and stops at a
 * ceiling, and the line under it tells the truth about the keyboard.
 *
 * jsdom lays nothing out, so `scrollHeight` — the number the box grows by — is
 * always 0. The stub below is a *model* of layout (a line height, a two-row
 * floor, the box's padding) read off the textarea's own value, so the assertions
 * stay about the composer's use of a measurement — grow, stop, collapse —
 * instead of about a number jsdom invented.
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

function renderComposer(disabled = false): { box: HTMLTextAreaElement; onSend: ReturnType<typeof vi.fn> } {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} disabled={disabled} />);
  const box = screen.getByLabelText('Message');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('the composer has no textarea');
  measuring(box);
  return { box, onSend };
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
    renderComposer(true);
    expect(screen.getByPlaceholderText('Connecting…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Enter to send · Shift+Enter for a newline')).toBeTruthy();
  });
});
