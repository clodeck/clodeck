import {
  isSelectablePermissionMode,
  SELECTABLE_PERMISSION_MODES,
  type BypassAvailability,
  type PermissionMode,
  type SelectablePermissionMode,
} from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import { Overlay } from '../dialogs';

/**
 * The mode this session runs under, beside the provider picker — the other half
 * of what the next message will be sent on (ticket 82).
 *
 * It is a **mode**, not a lock: unlike a profile, the choice is a filter for
 * what comes next rather than a transport fact that would poison the session,
 * so it stays open after the first turn (decision 11). It changes what the run
 * does with the *remaining* tool requests when picked mid-turn, and what the
 * next turn starts in either way.
 *
 * The four labels are the contract's, not the SDK's: the wire says `default`,
 * `acceptEdits`, `plan` and `bypassPermissions`, and the surface says Ask,
 * Accept edits, Plan and Bypass (ADR 0003). The name on screen is the promise;
 * the mechanism rides the tooltip and the wire.
 *
 * Bypass is set apart on purpose (ticket 85): it is only offered while the
 * server's gates allow it — and, when they do not, the row says why — and
 * choosing it passes through a confirmation that states the warning. A gate the
 * user cannot see is not a gate (decision 12).
 *
 * Its two states follow the provider picker's: a popup that closes on Escape or
 * a click anywhere else, and a line that always states the effective mode —
 * what the run kept, or what the user just chose.
 */

/**
 * The sentence the confirmation and the badge both carry, and the one the docs
 * repeat. It is the honest price of the "project settings can tighten, never
 * loosen" rule: Bypass silences every *gate clodeck adds*, and cannot silence
 * the project's own deny and ask rules.
 */
export const BYPASS_WARNING =
  "Every tool runs without asking. A project's own deny/ask rules in .claude/settings.json will still apply.";

const LABELS: Record<SelectablePermissionMode, string> = {
  default: 'Ask',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  bypassPermissions: 'Bypass',
};

/** The offered modes in menu order, labelled from the contract's names. */
const OPTIONS = SELECTABLE_PERMISSION_MODES.map((mode) => ({ mode, label: LABELS[mode] }));

interface PermissionModePickerProps {
  /** The effective mode: the run's, or the choice waiting for the next send. */
  mode: PermissionMode;
  /** Whether Bypass may be chosen here, and why not when it may not. */
  bypass: BypassAvailability;
  onChoose: (mode: PermissionMode) => void;
}

export function PermissionModePicker({
  mode,
  bypass,
  onChoose,
}: PermissionModePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  // The mode waiting on the confirmation. Nothing is chosen while it is set:
  // cancelling has to leave the previous mode exactly where it was.
  const [confirming, setConfirming] = useState(false);
  const label = permissionModeLabel(mode);

  const choose = (next: SelectablePermissionMode): void => {
    setOpen(false);
    // Bypass is the one mode that asks first; every other is a single click.
    if (next === 'bypassPermissions') {
      setConfirming(true);
      return;
    }
    onChoose(next);
  };

  return (
    // The key handler is on the wrapper: the trigger holds focus after it opens
    // the list, and its keydown bubbles to here (the provider picker's rule).
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="choose the permission mode this session runs in"
        onClick={() => {
          setOpen((was) => !was);
        }}
        className={`rounded border px-2 py-1 text-[11px] hover:bg-white/5 ${
          mode === 'bypassPermissions' ? 'border-err/60 text-err' : 'border-line text-ink'
        }`}
      >
        {label}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close permission mode list"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <ul
            role="listbox"
            aria-label="Permission mode"
            className="absolute bottom-full left-0 z-20 mb-1 flex w-56 flex-col rounded border border-line bg-panel py-1 shadow-lg"
          >
            {OPTIONS.map((option) => {
              // A refused Bypass is still *named* rather than removed: the row
              // is the one place the server's reason can explain itself.
              const refused = option.mode === 'bypassPermissions' && !bypass.allowed;

              return (
                <li key={option.mode}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.mode === mode}
                    aria-disabled={refused}
                    disabled={refused}
                    // The label is the promise; the wire value is the mechanism,
                    // and the two differ for Ask on purpose.
                    title={refused ? bypass.reason : option.mode}
                    onClick={() => {
                      choose(option.mode);
                    }}
                    className={`w-full px-3 py-1 text-left text-[11px] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 ${
                      option.mode === mode ? 'text-accent' : 'text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                  {refused && bypass.reason !== undefined && (
                    <p className="px-3 pb-1 text-[10px] text-ink-dim">{bypass.reason}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {confirming && (
        <BypassConfirmation
          onConfirm={() => {
            setConfirming(false);
            onChoose('bypassPermissions');
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The one confirmation Bypass has (ticket 85, decision 12). Confirm turns it on;
 * cancel does nothing at all — the previous mode is still the run's, because
 * nothing has been sent yet.
 *
 * There is deliberately no "remember this": every selection asks again. A mode
 * that runs every tool without asking should cost one conscious click each time
 * it is entered.
 */
function BypassConfirmation({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <Overlay label="Turn on Bypass">
      <h3 className="text-sm font-semibold text-err">Turn on Bypass?</h3>
      <p className="mt-2 text-xs text-ink-dim">{BYPASS_WARNING}</p>
      <p className="mt-2 text-xs text-ink-dim">
        Stay in Bypass until you switch to another mode, or start a new chat.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-err px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90"
        >
          Turn on Bypass
        </button>
      </div>
    </Overlay>
  );
}

/**
 * The contract's name for a mode. A mode outside the four offered today is
 * still rendered as its wire value rather than as a blank, so a snapshot from a
 * newer server never produces a nameless chip.
 */
function permissionModeLabel(mode: PermissionMode): string {
  return isSelectablePermissionMode(mode) ? LABELS[mode] : mode;
}
