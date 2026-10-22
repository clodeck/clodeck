// @vitest-environment jsdom
import type { BypassAvailability, PermissionMode } from '@clodeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BYPASS_WARNING, PermissionModePicker } from './PermissionModePicker';

/**
 * The chip beside the provider picker: what it says the session is running
 * under, and what it offers.
 *
 * A fixture rather than a socket, because what is pinned here is the
 * *rendering* — the label the contract promises for a wire value, the four
 * choices, the fact that no turn shuts the control, and the confirmation and
 * the refusal that set Bypass apart from the other three (ticket 85).
 */

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
});

const ALLOWED: BypassAvailability = { allowed: true };
const REFUSAL = 'Bypass is off on this server: CLODECK_ALLOW_BYPASS is off.';
const REFUSED: BypassAvailability = { allowed: false, reason: REFUSAL };

function renderPicker(
  mode: PermissionMode = 'default',
  bypass: BypassAvailability = ALLOWED,
): ReturnType<typeof vi.fn> {
  const onChoose = vi.fn();
  render(<PermissionModePicker mode={mode} bypass={bypass} onChoose={onChoose} />);
  return onChoose;
}

/** Open the menu and click an option. */
function pick(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^(Ask|Accept edits|Plan|Bypass)$/ }));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('the permission mode picker', () => {
  it('names the mode by what it promises, never by the wire value', () => {
    renderPicker('default');

    // `default` is a position, not a behaviour; the surface says Ask.
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'default' })).toBeNull();

    cleanup();
    renderPicker('bypassPermissions');
    expect(screen.getByRole('button', { name: 'Bypass' })).toBeTruthy();
  });

  it('offers the contract’s four modes, and nothing else', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    // `auto` and `dontAsk` are refused for good (ADR 0003).
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Ask',
      'Accept edits',
      'Plan',
      'Bypass',
    ]);
  });

  it('chooses by the wire value while showing the label', () => {
    const onChoose = renderPicker();

    pick('Accept edits');
    expect(onChoose).toHaveBeenCalledWith('acceptEdits');
    // The popup closes on the choice, as the provider picker's does.
    expect(screen.queryByRole('listbox')).toBeNull();

    pick('Plan');
    expect(onChoose).toHaveBeenCalledWith('plan');
  });

  it('asks before turning Bypass on, and chooses it only on the confirm', () => {
    const onChoose = renderPicker();

    pick('Bypass');
    // Nothing is chosen yet: the dialog's warning is the whole point of the
    // step, and cancel has to leave the previous mode exactly where it was.
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Turn on Bypass' })).toBeTruthy();
    expect(screen.getByText(BYPASS_WARNING)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    // And the second time through, the confirm is what chooses.
    pick('Bypass');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Bypass' }));
    expect(onChoose).toHaveBeenCalledWith('bypassPermissions');
  });

  it('refuses Bypass when the gates say no, and shows the reason', () => {
    const onChoose = renderPicker('default', REFUSED);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    // The row is still named — the reason needs a place to sit — but it is
    // dead, and the reason is the visible half of the gate.
    const option = screen.getByRole('option', { name: 'Bypass' });
    expect(option).toHaveProperty('disabled', true);
    expect(screen.getByText(REFUSAL)).toBeTruthy();

    fireEvent.click(option);
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('always states the effective mode, including one it cannot offer', () => {
    renderPicker('plan');
    expect(screen.getByRole('button', { name: 'Plan' })).toBeTruthy();

    cleanup();
    // A newer server's mode is still named rather than left blank; it is what
    // this session is running under, which the chip must not hide.
    renderPicker('auto');
    expect(screen.getByRole('button', { name: 'auto' })).toBeTruthy();
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
