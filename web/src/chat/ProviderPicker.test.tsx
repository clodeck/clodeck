// @vitest-environment jsdom
import type { ProviderProfileSummary } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderPicker } from './ProviderPicker';
import type { ProfilesState } from './useProfiles';

/**
 * The control beside the composer: what it says is running now, what it offers,
 * and the one thing it must never offer.
 *
 * The profiles here are a fixture rather than a fetch, because what is asserted
 * is the *rendering* of a list — which of a profile's fields reach the screen.
 * That the list comes from the server is `useProfiles`'s and the route's own
 * business.
 */

const PROFILES: ProviderProfileSummary[] = [
  { name: 'default', model: 'claude-opus-5-5' },
  { name: 'FAST', model: 'claude-haiku-5-5' },
  { name: 'BARE' },
];

const READY: ProfilesState = { status: 'ready', profiles: PROFILES };

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
});

function renderPicker(
  state: ProfilesState = READY,
  { name = 'default', locked = false }: { name?: string; locked?: boolean } = {},
): { onChoose: ReturnType<typeof vi.fn>; onReload: ReturnType<typeof vi.fn> } {
  const onChoose = vi.fn();
  const onReload = vi.fn();
  render(
    <ProviderPicker state={state} name={name} locked={locked} onChoose={onChoose} onReload={onReload} />,
  );
  return { onChoose, onReload };
}

describe('the provider picker', () => {
  it('says what is running now, in the profile’s and model’s own words', () => {
    renderPicker();

    // The reserved profile reads as what it is — this server's own environment —
    // and its model is the model that comes with it.
    expect(screen.getByRole('button', { name: 'running on server environment · claude-opus-5-5' })).toBeTruthy();
  });

  it('offers every profile by name and model, and offers nothing else about it', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /running on/ }));

    // Each row is exactly the profile's label and its model — there is no
    // endpoint and no credential on this screen because there is none to render:
    // the client is never sent one (ticket 68's last criterion).
    expect(screen.getByRole('option', { name: 'FAST · claude-haiku-5-5' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'server environment · claude-opus-5-5' })).toBeTruthy();
    // The name is what the wire carries, so a row still carries it for a reader
    // who wants the mechanism rather than the meaning.
    expect(screen.getByRole('option', { name: 'FAST · claude-haiku-5-5' }).getAttribute('title')).toBe('FAST');

    // A profile with no model of its own says so, rather than showing a blank.
    expect(screen.getByRole('option', { name: 'BARE · the endpoint decides' })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('chooses a profile by its name, and closes', () => {
    const { onChoose } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /running on/ }));
    fireEvent.click(screen.getByRole('option', { name: 'FAST · claude-haiku-5-5' }));

    expect(onChoose).toHaveBeenCalledWith('FAST');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is shut once a turn has run, with the reason on it', () => {
    const { onChoose } = renderPicker(READY, { name: 'FAST', locked: true });

    const trigger = screen.getByRole('button', { name: 'running on FAST · claude-haiku-5-5' });
    expect(trigger).toHaveProperty('disabled', true);

    // A disabled control gets no pointer events, so its own `title` never becomes
    // a tooltip — the reason rides the wrapper as well (the rail's rule).
    expect(trigger.getAttribute('title')).toContain('a turn has already run');
    expect(trigger.closest('span')?.getAttribute('title')).toContain('a turn has already run');

    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('still says what is running while the list is on its way, and offers a retry when it fails', () => {
    renderPicker({ status: 'loading' }, { name: 'FAST' });

    // Nothing is claimed about the model until the list has arrived to say what
    // it is: the line is the name alone.
    expect(screen.getByRole('button', { name: 'running on FAST' })).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();

    cleanup();
    const { onReload } = renderPicker({ status: 'error', message: '500 Internal Server Error' });
    expect(screen.getByText('profiles unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('closes on Escape, from the control that still holds focus', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: /running on/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
