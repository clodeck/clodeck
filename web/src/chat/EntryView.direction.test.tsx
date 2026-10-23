// @vitest-environment jsdom
import { cleanup, getByText, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryView, StreamingBubble } from './EntryView';

/**
 * A message's own direction.
 *
 * The message text is the one text in the transcript whose script the shell does
 * not choose: a Farsi answer with a Latin word in it is written right-to-left,
 * and in a paragraph laid out left-to-right its halves land on the wrong sides
 * of each other — read from the right, the second half comes first. `dir="auto"`
 * is the browser's rule for exactly this, the same rule ticket 56 gave a name
 * (`Name.tsx`); here it belongs to the message's own text element.
 *
 * jsdom lays nothing out, so a rendered test cannot see the wrong order itself;
 * it asserts the element rule that decides it — on the text and not on the
 * transcript, the head or the tile, which is where ticket 56's trap was.
 */

afterEach(cleanup);

/** A Farsi sentence with a Latin command in the middle: the reported failure. */
const MIXED = 'این پاسخ کوتاه است: npm run dev را اجرا کن و بعد ادامه بده.';

describe('the direction of a message', () => {
  it('lets an assistant message choose its direction from its own text', () => {
    const { container } = render(<EntryView entry={{ kind: 'assistant', text: MIXED }} />);

    expect(textOf(container, MIXED).getAttribute('dir')).toBe('auto');
  });

  it('does the same for a message still being written', () => {
    const { container } = render(<StreamingBubble text={MIXED} />);

    expect(textOf(container, MIXED).getAttribute('dir')).toBe('auto');
  });

  it('does the same for the user turn, whose own question is just as mixed', () => {
    const { container } = render(<EntryView entry={{ kind: 'user', text: MIXED }} />);

    expect(textOf(container, MIXED).getAttribute('dir')).toBe('auto');
  });

  it('does the same for the assistant reasoning it shows above an answer', () => {
    const { container } = render(<EntryView entry={{ kind: 'thinking', text: MIXED }} />);

    expect(textOf(container, MIXED).getAttribute('dir')).toBe('auto');
  });

  it('sets the rule on the text alone, so nothing around it moves', () => {
    const { container } = render(<EntryView entry={{ kind: 'assistant', text: MIXED }} />);
    const text = textOf(container, MIXED);

    // The tile is beside the message, never inside the element that declares a
    // direction — otherwise the head would flip with the words.
    expect(text.querySelector('[data-assistant-tile]')).toBeNull();
    // And no ancestor declares a direction: the head and the transcript keep
    // the shell's own, so one message cannot turn the surface it sits on.
    for (let node = text.parentElement; node !== null; node = node.parentElement) {
      expect(node.getAttribute('dir')).toBeNull();
    }
  });
});

/** The element a message's text is drawn in. */
function textOf(container: HTMLElement, text: string): HTMLElement {
  return getByText(container, text);
}
