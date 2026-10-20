import type { PermissionMode } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

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
 * The three labels are the contract's, not the SDK's: the wire says `default`,
 * `acceptEdits` and `plan`, and the surface says Ask, Accept edits and Plan
 * (ADR 0003). The name on screen is the promise; the mechanism rides the
 * tooltip and the wire.
 *
 * Its two states follow the provider picker's: a popup that closes on Escape or
 * a click anywhere else, and a line that always states the effective mode —
 * what the run kept, or what the user just chose.
 */

/**
 * What the picker may offer. Bypass is absent on purpose: its gates and its
 * confirmation are ticket 85's, and the server refuses the value until then.
 */
const OPTIONS: readonly { mode: PermissionMode; label: string }[] = [
  { mode: 'default', label: 'Ask' },
  { mode: 'acceptEdits', label: 'Accept edits' },
  { mode: 'plan', label: 'Plan' },
];

interface PermissionModePickerProps {
  /** The effective mode: the run's, or the choice waiting for the next send. */
  mode: PermissionMode;
  onChoose: (mode: PermissionMode) => void;
}

export function PermissionModePicker({ mode, onChoose }: PermissionModePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const label = permissionModeLabel(mode);

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
        className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
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
            className="absolute bottom-full left-0 z-20 mb-1 flex w-40 flex-col rounded border border-line bg-panel py-1 shadow-lg"
          >
            {OPTIONS.map((option) => (
              <li key={option.mode}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.mode === mode}
                  // The label is the promise; the wire value is the mechanism,
                  // and the two differ for Ask on purpose.
                  title={option.mode}
                  onClick={() => {
                    onChoose(option.mode);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-1 text-left text-[11px] hover:bg-white/5 ${
                    option.mode === mode ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The contract's name for a mode. A mode outside the three offered today is
 * still rendered as its wire value rather than as a blank, so a snapshot from a
 * newer server never produces a nameless chip.
 */
export function permissionModeLabel(mode: PermissionMode): string {
  return OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}
