// @vitest-environment jsdom
import { cleanup, getByText, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryView } from './EntryView';
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

/** The `Result` disclosure, or null while the card has no result. */
function resultBody(container: HTMLElement): HTMLDetailsElement | null {
  return (
    [...container.querySelectorAll('details')].find(
      (details) => details.querySelector('summary')?.textContent === 'Result',
    ) ?? null
  );
}
