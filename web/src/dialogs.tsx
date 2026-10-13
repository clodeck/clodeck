import { useState, type ReactElement, type ReactNode } from 'react';

/**
 * The app's modal pieces, in one module because they have two callers now: the
 * file drawer's create/rename prompt and the sidebar's `New project` (ticket
 * 47). They were the drawer's private components until then, and the second
 * caller is what made them shared — a second name dialog would have been a
 * second set of refusals-in-the-dialog to keep in step with the first.
 *
 * `Overlay` is the frame: a modal panel centred over whatever it is mounted in.
 * It is `absolute`, not `fixed` — it dims the *surface* it belongs to (the
 * drawer's panel, the sidebar column) rather than the whole window — so each
 * caller mounts it inside a positioned ancestor of the right size.
 */

/**
 * The inline name prompt for create / rename / new project. It owns the typing
 * and the disabled-confirm rule; the caller owns what a submit *means*, which is
 * why a refusal comes back as the `error` prop and leaves the dialog open.
 *
 * The rule is a prop rather than a default because the two callers have
 * different ones: a file name is a drawer name (`isValidName`), while a project
 * name is that *and* non-dot (discovery skips dot-directories, so such a project
 * would never be listed).
 */
export function NameDialog({
  title,
  confirmLabel,
  initial,
  error,
  isValid,
  onSubmit,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  initial: string;
  error: string | null;
  isValid: (name: string) => boolean;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(initial);
  const name = value.trim();
  const valid = isValid(name);

  return (
    <Overlay label={title}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void onSubmit(name);
        }}
      >
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(event) => { setValue(event.target.value); }}
          aria-label="Name"
          placeholder="name"
          className="mt-3 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-[12px] text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
        />
        {error !== null && <p className="mt-2 font-mono text-[11px] break-words text-err">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

export function Overlay({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-4"
      >
        {children}
      </div>
    </div>
  );
}
