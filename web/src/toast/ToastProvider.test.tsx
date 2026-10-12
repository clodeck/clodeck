// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast } from './ToastProvider';

/**
 * The toast surface's own contract — the half that is not any one operation: one
 * message at a time, transient, and a live region so it is announced rather than
 * only seen. The file operations that speak through it are asserted where they
 * live (`files/FilePanel.test.tsx`).
 */

function Sender(): ReactElement {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => { toast('created notes.md'); }}>
        first
      </button>
      <button type="button" onClick={() => { toast('deleted notes.md'); }}>
        second
      </button>
      <button type="button" onClick={() => { toast('2 uploaded · 1 failed', '409 Conflict: already exists'); }}>
        detailed
      </button>
    </>
  );
}

function renderProvider(): HTMLElement {
  render(
    <ToastProvider>
      <Sender />
    </ToastProvider>,
  );
  return screen.getByRole('status');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the toast surface', () => {
  it('is a live region, in the document whether or not it has anything to say', () => {
    const region = renderProvider();

    // Always mounted, and empty rather than absent: a live region that appears
    // together with its text is missed by screen readers that only watch
    // regions already in the tree.
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
  });

  it('holds one message at a time — the newest replaces the last', () => {
    const region = renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    expect(region.textContent).toBe('created notes.md');

    fireEvent.click(screen.getByRole('button', { name: 'second' }));
    expect(region.textContent).toBe('deleted notes.md');
    // One surface, not a stack of them.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('carries a detail under the message, and drops it with the next one', async () => {
    const region = renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'detailed' }));
    // Both halves are the message: the count is what happened, the reason is why
    // part of it did not. Say them together or the reason is swallowed.
    expect(within(region).getByText('2 uploaded · 1 failed')).toBeTruthy();
    expect(within(region).getByText('409 Conflict: already exists')).toBeTruthy();

    // A message without a detail takes the last one away with it.
    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    expect(within(region).queryByText('409 Conflict: already exists')).toBeNull();
    expect(region.textContent).toBe('created notes.md');
  });

  it('takes the message away on its own after about two seconds', () => {
    // Only the surface's own timer is faked: faking `queueMicrotask` too would
    // stall React's act(), which is what flushes the state change under test.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const region = renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'first' }));
    expect(region.textContent).toBe('created notes.md');

    act(() => {
      vi.advanceTimersByTime(2300);
    });
    expect(region.textContent).toBe('');
  });
});
