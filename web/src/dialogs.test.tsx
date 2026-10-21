// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NameDialog } from './dialogs';
import { MAX_NAME_BYTES, nameRefusal } from './files/reducer';

/**
 * The name dialog's own half of ticket 54: a name the server would refuse for
 * its length leaves the confirm dead *and* says why, in the line the server's
 * refusal already uses — rather than enabling a request that can only come back
 * a `400`. The rule itself is unit-tested at its boundary in `reducer.test.ts`;
 * what is asserted here is what the user sees: the dead button and the reason.
 */

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
  vi.unstubAllGlobals();
});

/** The dialog, with the drawer's own rule — the shared one both callers send. */
function renderDialog(): { dialog: HTMLElement; confirm: HTMLElement } {
  render(
    <NameDialog
      title="New file"
      confirmLabel="Create"
      initial=""
      error={null}
      refusal={nameRefusal}
      onSubmit={vi.fn(async () => {})}
      onCancel={vi.fn()}
    />,
  );

  const dialog = screen.getByRole('dialog', { name: 'New file' });
  return { dialog, confirm: screen.getByRole('button', { name: 'Create' }) };
}

/** Type a name into the dialog's one box. */
function type(text: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } });
}

/** The typed-name confirmation of a project delete, with no name rule of its own. */
function renderTypedDialog(options: { path?: string } = {}): {
  dialog: HTMLElement;
  confirm: HTMLElement;
  cancel: HTMLElement;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
} {
  const onSubmit = vi.fn(async () => {});
  const onCancel = vi.fn();
  render(
    <NameDialog
      title="Delete project"
      confirmLabel="Delete"
      initial=""
      error={null}
      typedName={{ name: 'alpha', ...options }}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );

  return {
    dialog: screen.getByRole('dialog', { name: 'Delete project' }),
    confirm: screen.getByRole('button', { name: 'Delete' }),
    cancel: screen.getByRole('button', { name: 'Cancel' }),
    onSubmit,
    onCancel,
  };
}

describe('NameDialog', () => {
  it('kills the confirm and says why for a name over the server’s byte cap', () => {
    const { dialog, confirm } = renderDialog();

    type('a'.repeat(MAX_NAME_BYTES + 1));

    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(dialog.textContent).toContain(`${String(MAX_NAME_BYTES)} bytes`);

    // One byte under is the server's last accepted name, and the message goes.
    type('a'.repeat(MAX_NAME_BYTES));
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(dialog.querySelector('p')).toBeNull();
  });

  it('counts a multi-byte name in bytes, so fewer characters still fit', () => {
    const { confirm } = renderDialog();

    // 128 `é` is 256 bytes over the wire and 128 characters on screen.
    type('é'.repeat(128));
    expect(confirm.hasAttribute('disabled')).toBe(true);

    type('é'.repeat(127));
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('leaves an empty box silent — the dead confirm is the whole of it', () => {
    const { dialog, confirm } = renderDialog();

    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(dialog.querySelector('p')).toBeNull();
  });

  it('keeps the server’s word in the line until the box has a reason of its own', () => {
    render(
      <NameDialog
        title="New file"
        confirmLabel="Create"
        initial="notes.txt"
        error="409 Conflict: already exists"
        refusal={nameRefusal}
        onSubmit={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    );

    // A name the rule accepts has nothing of its own to say, so the server's
    // refusal on the last submit — `error` — keeps the line.
    const dialog = screen.getByRole('dialog', { name: 'New file' });
    expect(dialog.textContent).toContain('already exists');

    // A name the rule can refuse for itself speaks for the box instead: the
    // server's word was about the name that was submitted, not about this one.
    type('a'.repeat(MAX_NAME_BYTES + 1));
    expect(dialog.textContent).toContain(`${String(MAX_NAME_BYTES)} bytes`);
    expect(dialog.textContent).not.toContain('already exists');
  });

  it('keeps the confirm dead until the exact name is typed, case included', () => {
    const { confirm } = renderTypedDialog();

    expect(confirm.hasAttribute('disabled')).toBe(true);

    type('alph');
    expect(confirm.hasAttribute('disabled')).toBe(true);

    // The right letters in the wrong case are still the wrong name.
    type('Alpha');
    expect(confirm.hasAttribute('disabled')).toBe(true);

    type('alpha');
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('shows the path beside the field, and no path line when there is none', () => {
    const { dialog } = renderTypedDialog({ path: '/srv/projects/alpha' });

    expect(dialog.textContent).toContain('/srv/projects/alpha');
    expect(dialog.textContent).toContain('This cannot be undone.');

    cleanup();

    const { dialog: withoutPath } = renderTypedDialog();
    expect(withoutPath.textContent).not.toContain('/srv/projects/alpha');
    expect(withoutPath.textContent).toContain('This cannot be undone.');
  });

  it('always offers a Cancel that does nothing but call back', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { confirm, cancel, onSubmit, onCancel } = renderTypedDialog();

    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(cancel);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
