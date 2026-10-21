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
 * The rule is a prop because the callers have different ones: a file name is a
 * drawer name (`nameRefusal`), while a project name is that *and* non-dot
 * (discovery skips dot-directories, so such a project would never be listed).
 * The rule answers with a reason, not a bare `false`, so the dialog can say why
 * the confirm is dead in the box it is sitting over — the server's own refusal
 * still lands in the same line, for the refusals the client cannot see coming. A
 * caller with no name rule of its own, like the typed-name confirmation, can
 * leave it out.
 *
 * `typedName` opts into that confirmation: nothing enables the button until the
 * box spells the existing name exactly, case-sensitively, and the dialog shows
 * the path that action would take (when the caller has one to show) and says it
 * cannot be undone. Callers that do not pass it see the dialog they always had.
 */
export function NameDialog({
  title,
  confirmLabel,
  initial,
  error,
  refusal = () => null,
  typedName,
  onSubmit,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  initial: string;
  error: string | null;
  refusal?: (name: string) => string | null;
  typedName?: { name: string; path?: string };
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(initial);
  const name = value.trim();
  const refused = refusal(name);
  // Against the raw box, not the trimmed `name`: the confirmation is of exactly
  // what was typed, whitespace and case included, not of what a submit would send.
  const typedOk = typedName === undefined || value === typedName.name;
  const valid = refused === null && typedOk;
  // The client's refusal is about the box's *current* content, so it speaks for
  // it while there is anything to refuse; otherwise the caller's `error` — the
  // server's word on the last submit — keeps the line. An empty box says
  // nothing: there is nothing to explain yet, and the dead confirm is the whole
  // of it.
  const message = refused !== null && name !== '' ? refused : error;

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
        {typedName?.path !== undefined && (
          <p className="mt-2 font-mono text-[11px] break-words text-ink-dim">{typedName.path}</p>
        )}
        {typedName !== undefined && (
          <p className="mt-1 text-[12px] text-ink-dim">This cannot be undone.</p>
        )}
        {message !== null && (
          <p className="mt-2 font-mono text-[11px] break-words text-err">{message}</p>
        )}
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
