// @vitest-environment jsdom
import { cleanup, getByText, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryView, StreamingBubble } from './EntryView';
import type { ToolEntry, ToolResultView } from './reducer';

/**
 * The tool card's status. Both the live chat and the read-only history
 * transcript render through `EntryView`, so pinning the card here pins it for
 * both surfaces — there is no second card to test.
 */

afterEach(cleanup);

const okResult: ToolResultView = { content: 'total 0', isError: false };

function toolEntry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    kind: 'tool',
    toolUseId: 'tool-1',
    name: 'Bash',
    input: { command: 'ls' },
    result: null,
    children: [],
    ...overrides,
  };
}

/**
 * The shell's surface scale (ticket 49). jsdom does not process the stylesheet,
 * so a rendered test can only name the utility; whether the resulting tone reads
 * as a step up from the one below it is the browser's to say.
 */
describe('the tool card surfaces', () => {
  it('sits on the scale, its head a step above its body', () => {
    const { container } = render(<EntryView entry={toolEntry({ result: okResult })} />);

    const card = container.firstElementChild;
    const head = card?.firstElementChild;
    if (!(card instanceof HTMLElement) || !(head instanceof HTMLElement)) {
      throw new Error('expected a card with a head');
    }

    expect(card.className).toContain('bg-bg-1');
    expect(head.className).toContain('bg-bg-2');
    // The card is no longer the sidebar's own surface — that was the flatness.
    expect(card.className).not.toContain('bg-panel');
  });

  it('gives a user bubble a level rather than a white wash', () => {
    const { container } = render(<EntryView entry={{ kind: 'user', text: 'hello' }} />);

    const bubble = getByText(container, 'hello');
    expect(bubble.className).toContain('bg-bg-3');
    expect(bubble.className).not.toContain('bg-white/10');
  });
});

describe('the tool card status badge', () => {
  it('reads as in progress while the tool has no result', () => {
    const { container } = render(<EntryView entry={toolEntry()} />);

    expect(container.textContent).toContain('running…');
    expect(resultBody(container)).toBeNull();
  });

  it('marks a finished call done, in the palette success token', () => {
    const { container } = render(<EntryView entry={toolEntry({ result: okResult }) } />);

    expect(getByText(container, 'done').className).toContain('text-ok');
  });

  it('marks a failed call error, in the palette error token', () => {
    const { container } = render(
      <EntryView entry={toolEntry({ result: { content: 'boom', isError: true } })} />,
    );

    expect(getByText(container, 'error').className).toContain('text-err');
    expect(getByText(container, 'Error')).toBeDefined();
  });

  it('opens the result body by itself once the result arrives', () => {
    const { container } = render(<EntryView entry={toolEntry({ result: okResult })} />);

    expect(resultBody(container)?.open).toBe(true);
  });

  it('opens it on arrival for a card that was running, and does not fight the reader afterwards', () => {
    const { container, rerender } = render(<EntryView entry={toolEntry()} />);
    expect(resultBody(container)).toBeNull();

    rerender(<EntryView entry={toolEntry({ result: okResult })} />);
    const opened = resultBody(container);
    expect(opened?.open).toBe(true);

    // The reader collapses it; the transcript re-renders as the turn streams on.
    if (opened === null) throw new Error('expected an opened result body');
    opened.open = false;
    rerender(<EntryView entry={toolEntry({ result: okResult, children: [] })} />);

    expect(resultBody(container)?.open).toBe(false);
  });
});

/**
 * The assistant's tile (ticket 51). Its presence on the assistant's own text and
 * its absence everywhere else are the same rule seen twice: the transcript lists
 * entries, not turns, so the tile marks the one entry kind that is the assistant
 * speaking.
 */
describe('the assistant tile', () => {
  it('marks an assistant message', () => {
    const { container } = render(<EntryView entry={{ kind: 'assistant', text: 'hello' }} />);

    expect(tiles(container)).toHaveLength(1);
  });

  it('leaves a user turn to its `You` label and its bubble', () => {
    const { container } = render(<EntryView entry={{ kind: 'user', text: 'hello' }} />);

    expect(tiles(container)).toHaveLength(0);
    expect(getByText(container, 'You')).toBeDefined();
  });

  it('leaves the entries that belong to the message above them bare', () => {
    const thinking = render(<EntryView entry={{ kind: 'thinking', text: 'hmm' }} />);
    expect(tiles(thinking.container)).toHaveLength(0);

    const notice = render(<EntryView entry={{ kind: 'notice', text: 'Interrupted' }} />);
    expect(tiles(notice.container)).toHaveLength(0);

    const tool = render(<EntryView entry={toolEntry({ result: okResult })} />);
    expect(tiles(tool.container)).toHaveLength(0);
  });

  it('is decorative, and a long message does not stretch it', () => {
    const { container } = render(
      <EntryView entry={{ kind: 'assistant', text: 'a long answer '.repeat(50) }} />,
    );

    const tile = tiles(container)[0];
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
    expect(tile?.textContent).toBe('');
    expect(tile?.className).toContain('h-[26px]');
    expect(tile?.className).toContain('shrink-0');
  });

  it('heads the message that is still streaming, not only the settled entry', () => {
    const { container } = render(<StreamingBubble text="half an ans" />);

    expect(tiles(container)).toHaveLength(1);
  });
});

/** Every tile the transcript is currently drawing. */
function tiles(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-assistant-tile]')];
}

/** The `Result` disclosure, or null while the card has no result. */
function resultBody(container: HTMLElement): HTMLDetailsElement | null {
  return (
    [...container.querySelectorAll('details')].find(
      (details) => details.querySelector('summary')?.textContent === 'Result',
    ) ?? null
  );
}
