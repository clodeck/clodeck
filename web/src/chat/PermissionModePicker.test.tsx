// @vitest-environment jsdom
import type { PermissionMode } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionModePicker } from './PermissionModePicker';

/**
 * The chip beside the provider picker: what it says the session is running
 * under, and what it offers.
 *
 * A fixture rather than a socket, because what is pinned here is the
 * *rendering* — the label the contract promises for a wire value, the three
 * choices, and the fact that no turn shuts the control.
 */

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
});

function renderPicker(mode: PermissionMode = 'default'): ReturnType<typeof vi.fn> {
  const onChoose = vi.fn();
  render(<PermissionModePicker mode={mode} onChoose={onChoose} />);
  return onChoose;
}

describe('the permission mode picker', () => {
  it('names the mode by what it promises, never by the wire value', () => {
    renderPicker('default');

    // `default` is a position, not a behaviour; the surface says Ask.
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'default' })).toBeNull();
  });

  it('offers Ask, Accept edits and Plan, and nothing else yet', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    // Bypass waits for its gates (ticket 85), and the other two wire modes are
    // refused for good (ADR 0003).
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Ask',
      'Accept edits',
      'Plan',
    ]);
  });

  it('chooses by the wire value while showing the label', () => {
    const onChoose = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(screen.getByRole('option', { name: 'Accept edits' }));
    expect(onChoose).toHaveBeenCalledWith('acceptEdits');
    // The popup closes on the choice, as the provider picker's does.
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(screen.getByRole('option', { name: 'Plan' }));
    expect(onChoose).toHaveBeenCalledWith('plan');
  });

  it('always states the effective mode, including one it cannot offer', () => {
    renderPicker('plan');
    expect(screen.getByRole('button', { name: 'Plan' })).toBeTruthy();

    cleanup();
    // A newer server's mode is still named rather than left blank; it is what
    // this session is running under, which the chip must not hide.
    renderPicker('bypassPermissions');
    expect(screen.getByRole('button', { name: 'bypassPermissions' })).toBeTruthy();
  });

  it('never locks: a turn in flight leaves the control usable', () => {
    renderPicker('default');

    // Unlike the provider, the mode is not a transport fact — the component has
    // no lock to take, so a running turn cannot shut it.
    const trigger = screen.getByRole('button', { name: 'Ask' });
    expect(trigger).toHaveProperty('disabled', false);

    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).not.toBeNull();
  });

  it('closes on Escape, from the control that still holds focus', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: 'Ask' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
