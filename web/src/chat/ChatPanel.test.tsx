// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../toast/ToastProvider';
import { ChatPanel } from './ChatPanel';

/**
 * The chat's column (ticket 50). jsdom computes no boxes, so what is pinned here
 * is the thing boxes are made of: the transcript, the composer and the chat's
 * own status surfaces all sit in **one** band — the same element, at the same
 * width — instead of each taking the full width of the stage. The geometry
 * itself (that the band is 780px and centred, that a turn's insides are
 * untouched) is a real browser's to confirm.
 *
 * The `snapshot` and the session list are fetched on mount; a 404 leaves both in
 * their error states, which is not what this file is about.
 */

const project: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };

/** Every band the chat is currently drawing, in document order. */
function columns(baseElement: HTMLElement): HTMLElement[] {
  return [...baseElement.querySelectorAll<HTMLElement>('[data-chat-column]')];
}

beforeEach(() => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
  );
});

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

describe('the chat column', () => {
  it('puts the transcript and the composer in one band of one width', () => {
    const { baseElement } = render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);

    const [transcript, composer] = columns(baseElement);
    expect(transcript).toBeDefined();
    expect(composer).toBeDefined();

    // The transcript's half, and the composer's half, of the same column.
    expect(transcript?.contains(screen.getByText('Send a prompt to start the session.'))).toBe(true);
    expect(composer?.contains(screen.getByLabelText('Message'))).toBe(true);

    // Not two bands that happen to match — the one column, so one class string:
    // one width, centred, at today's gutter.
    expect(transcript?.className).toBe(composer?.className);
    expect(transcript?.className).toContain('max-w-[780px]');
    expect(transcript?.className).toContain('mx-auto');
    expect(transcript?.className).toContain('px-4');
  });

  it('bands the history browser too, and leaves the surfaces behind them full-bleed', () => {
    const { baseElement } = render(<ToastProvider><ChatPanel project={project} /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));

    // The browser's own rule and wash stay the width of the stage; what it
    // *lists* is in the column.
    const browser = baseElement.querySelector<HTMLElement>('[aria-label="Session history"]');
    expect(browser?.className).toContain('border-b');
    expect(browser?.querySelector('[data-chat-column]')).not.toBeNull();
    expect(columns(baseElement)).toHaveLength(3);

    // The footer's rule is full-bleed too; its one child is the column that
    // carries the status lines and the composer.
    const footer = baseElement.querySelector<HTMLElement>('footer');
    expect(footer?.className).toContain('border-t');
    expect(footer?.firstElementChild?.getAttribute('data-chat-column')).not.toBeNull();
  });
});
