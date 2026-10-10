import type { FileEntry, Project } from '@clodeck/shared';
import { useRef, useState, type ChangeEvent, type DragEvent, type ReactElement, type ReactNode } from 'react';

import { assertNever, isValidName, joinPath, type DirListing } from './reducer';
import { useFiles, type FileViewer, type FileViewerActions, type PreviewState } from './useFiles';

/**
 * The file drawer — the view half of `useFiles`. It is keyed by project id in
 * `App` (like `ChatPanel` / `TerminalPanel`), so switching projects remounts a
 * fresh drawer rather than carrying one project's tree and preview into another.
 *
 * The drawer is now a **tree**: folders expand in place (a click toggles them,
 * it never navigates), each expanded folder's listing is fetched lazily on first
 * open, and the last folder clicked is the "active" folder that New File/Folder
 * and Upload land in. The preview pane starts **read-only** and flips to a
 * writable `<textarea>` with Save/Cancel — the content-editing toggle.
 *
 * Two rules are load-bearing, not style:
 *
 * - File bytes are rendered **only** as React text nodes (`<pre>{content}</pre>`
 *   and a controlled `<textarea value>`); there is no `innerHTML` and no
 *   `dangerouslySetInnerHTML` anywhere, because a file's bytes are untrusted.
 * - Every renderer over a closed union is an exhaustive `switch` ending in
 *   {@link assertNever}, so a new entry type or content kind is a compile error.
 */

export function FilePanel({ project }: { project: Project }): ReactElement {
  const { viewer, actions } = useFiles(project);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const activeLabel = viewer.status === 'ready' ? (viewer.active === '' ? 'root' : viewer.active) : null;

  const uploadFiles = (files: readonly File[]): void => {
    for (const file of files) {
      void actions.upload(file).catch((error: unknown) => {
        setNotice(messageOf(error));
      });
    }
  };

  const onChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (files !== null) uploadFiles(Array.from(files));
    // Reset so picking the same file again still fires `change`.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    uploadFiles(Array.from(event.dataTransfer.files));
  };

  const submitPrompt = async (name: string): Promise<void> => {
    if (prompt === null) return;
    try {
      if (prompt.mode === 'rename') await actions.rename(prompt.path, name);
      else await actions.create(prompt.mode === 'create-file' ? 'file' : 'directory', name);
      setPrompt(null);
      setPromptError(null);
    } catch (error) {
      setPromptError(messageOf(error));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (confirm === null) return;
    try {
      await actions.remove(confirm.path);
      setConfirm(null);
      setConfirmError(null);
    } catch (error) {
      setConfirmError(messageOf(error));
    }
  };

  return (
    <section className="relative flex min-h-0 flex-col" aria-label="Files">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Files</h2>
          {activeLabel !== null && (
            <span
              className="truncate font-mono text-[10px] text-ink-dim/70"
              title={`New file, new folder and upload land in: ${activeLabel}`}
            >
              in {activeLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => { setPrompt({ mode: 'create-file' }); setPromptError(null); }}>New File</ToolbarButton>
          <ToolbarButton onClick={() => { setPrompt({ mode: 'create-folder' }); setPromptError(null); }}>New Folder</ToolbarButton>
          <ToolbarButton onClick={() => { fileInput.current?.click(); }}>Upload</ToolbarButton>
          <ToolbarButton onClick={() => { setNotice(null); actions.refresh(); }}>Refresh</ToolbarButton>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={onChosen}
        aria-label="Choose files to upload"
      />

      {notice !== null && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-err">{notice}</p>
          <button
            type="button"
            onClick={() => { setNotice(null); }}
            className="shrink-0 rounded px-1 text-[11px] text-ink-dim hover:text-ink"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
        onDragOver={(event) => { event.preventDefault(); }}
        onDrop={onDrop}
      >
        <ViewerBody
          viewer={viewer}
          menu={menu}
          actions={actions}
          onMenu={setMenu}
          onRename={(path, initial) => { setMenu(null); setPrompt({ mode: 'rename', path, initial }); setPromptError(null); }}
          onDelete={(entry) => { setMenu(null); setConfirm(entry); setConfirmError(null); }}
        />
      </div>

      {viewer.status === 'ready' && viewer.preview.kind !== 'none' && (
        <PreviewPane preview={viewer.preview} actions={actions} />
      )}

      {prompt !== null && (
        <NameDialog
          title={prompt.mode === 'rename' ? 'Rename' : prompt.mode === 'create-file' ? 'New file' : 'New folder'}
          confirmLabel={prompt.mode === 'rename' ? 'Rename' : 'Create'}
          initial={prompt.mode === 'rename' ? prompt.initial : ''}
          error={promptError}
          onSubmit={submitPrompt}
          onCancel={() => { setPrompt(null); }}
        />
      )}

      {confirm !== null && (
        <ConfirmDialog
          entry={confirm}
          error={confirmError}
          onConfirm={confirmDelete}
          onCancel={() => { setConfirm(null); }}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The body, dispatched on the viewer's status                                */
/* -------------------------------------------------------------------------- */

function ViewerBody({
  viewer,
  menu,
  actions,
  onMenu,
  onRename,
  onDelete,
}: {
  viewer: FileViewer;
  menu: string | null;
  actions: FileViewerActions;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  switch (viewer.status) {
    case 'idle':
      return <Hint>Select a project to browse its files.</Hint>;
    case 'loading':
      return <Hint>Loading…</Hint>;
    case 'error':
      return <DirError message={viewer.message} onRetry={actions.refresh} />;
    case 'ready':
      return (
        <TreeLevel
          path=""
          depth={0}
          dirs={viewer.dirs}
          expanded={viewer.expanded}
          active={viewer.active}
          menu={menu}
          actions={actions}
          onMenu={onMenu}
          onRename={onRename}
          onDelete={onDelete}
        />
      );
    default:
      return assertNever(viewer);
  }
}

/* -------------------------------------------------------------------------- */
/* The recursive tree                                                         */
/* -------------------------------------------------------------------------- */

function TreeLevel({
  path,
  depth,
  dirs,
  expanded,
  active,
  menu,
  actions,
  onMenu,
  onRename,
  onDelete,
}: {
  path: string;
  depth: number;
  dirs: Record<string, DirListing>;
  expanded: Record<string, true>;
  active: string;
  menu: string | null;
  actions: FileViewerActions;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const listing = dirs[path];
  // A not-yet-fetched directory (its parent expanded first) reads as loading.
  if (listing === undefined) return <Hint>Loading…</Hint>;

  switch (listing.status) {
    case 'loading':
      return <Hint>Loading…</Hint>;
    case 'error':
      return <DirError message={listing.message} onRetry={actions.refresh} />;
    case 'ready':
      if (listing.entries.length === 0) {
        return depth === 0 ? <Hint>This folder is empty.</Hint> : <span />;
      }
      return (
        <ul className="flex flex-col">
          {listing.entries.map((entry) => {
            const childPath = joinPath(path, entry.name);
            const isDir = entry.type === 'directory';
            const isExpanded = isDir && expanded[childPath] === true;
            return (
              <li key={childPath}>
                <EntryRow
                  entry={entry}
                  path={childPath}
                  depth={depth}
                  isExpanded={isExpanded}
                  isActive={isDir && active === childPath}
                  menuOpen={menu === childPath}
                  actions={actions}
                  onMenu={onMenu}
                  onRename={onRename}
                  onDelete={onDelete}
                />
                {isExpanded && (
                  <TreeLevel
                    path={childPath}
                    depth={depth + 1}
                    dirs={dirs}
                    expanded={expanded}
                    active={active}
                    menu={menu}
                    actions={actions}
                    onMenu={onMenu}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                )}
              </li>
            );
          })}
        </ul>
      );
    default:
      return assertNever(listing);
  }
}

/* -------------------------------------------------------------------------- */
/* One row                                                                    */
/* -------------------------------------------------------------------------- */

function EntryRow({
  entry,
  path,
  depth,
  isExpanded,
  isActive,
  menuOpen,
  actions,
  onMenu,
  onRename,
  onDelete,
}: {
  entry: FileEntry;
  path: string;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  menuOpen: boolean;
  actions: FileViewerActions;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const isDir = entry.type === 'directory';

  return (
    <div
      className={`flex items-center gap-1 rounded hover:bg-white/5 ${isActive ? 'bg-white/5' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <EntryMain
        entry={entry}
        isExpanded={isExpanded}
        onClick={isDir ? () => actions.toggle(path) : () => actions.preview(path)}
      />
      <button
        type="button"
        aria-label={`Actions for ${entry.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => { onMenu(menuOpen ? null : path); }}
        className="shrink-0 rounded px-1.5 py-1 text-ink-dim hover:bg-white/10 hover:text-ink"
      >
        ⋯
      </button>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => { onMenu(null); }}
          />
          <div
            role="menu"
            className="absolute top-full right-0 z-20 mt-1 flex w-32 flex-col rounded border border-line bg-panel py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { onRename(path, entry.name); }}
              className="px-3 py-1 text-left text-[11px] text-ink hover:bg-white/5"
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { onDelete({ path, name: entry.name, isDirectory: entry.type === 'directory' }); }}
              className="px-3 py-1 text-left text-[11px] text-err hover:bg-white/5"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EntryMain({
  entry,
  isExpanded,
  onClick,
}: {
  entry: FileEntry;
  isExpanded: boolean;
  onClick: () => void;
}): ReactElement {
  switch (entry.type) {
    case 'directory':
      return (
        <RowButton onClick={onClick} title={isExpanded ? 'Collapse folder' : 'Expand folder'}>
          <span className="text-ink-dim">{isExpanded ? '▾ ' : '▸ '}</span>
          {entry.name}/
        </RowButton>
      );
    case 'file':
      return (
        <RowButton onClick={onClick} title={`Preview ${entry.name}`}>
          {entry.name}
        </RowButton>
      );
    case 'symlink':
      // Visible, never navigable: the server reported a link that resolves
      // outside the project root (or is broken), so there is nothing safe to
      // open. It is a plain span, not a button.
      return (
        <span
          className="min-w-0 flex-1 cursor-default truncate px-2 py-1 font-mono text-[12px] text-ink-dim"
          title="symlink escaping the project — shown, not navigable"
        >
          <span className="text-ink-dim">↗ </span>
          {entry.name}
        </span>
      );
    default:
      return assertNever(entry);
  }
}

function RowButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left font-mono text-[12px] text-ink hover:text-accent"
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview + editor                                                           */
/* -------------------------------------------------------------------------- */

function PreviewPane({ preview, actions }: { preview: PreviewState; actions: FileViewerActions }): ReactElement | null {
  switch (preview.kind) {
    case 'none':
      return null;
    case 'loading':
      return <PreviewFrame name={preview.name}>Loading…</PreviewFrame>;
    case 'text':
      return (
        <PreviewFrame
          name={preview.name}
          note={preview.truncated ? 'truncated' : 'read-only'}
          // A truncated file holds only the 256 KiB prefix; editing it would
          // clobber the rest, so the writable toggle is withheld.
          actions={preview.truncated ? null : <EditToggle onClick={actions.edit} />}
        >
          {/* A file's bytes are untrusted: they are a React text node, never HTML. */}
          <pre className="overflow-auto p-2 font-mono text-[11px] whitespace-pre text-ink">{preview.content}</pre>
        </PreviewFrame>
      );
    case 'binary':
      return <PreviewFrame name={preview.name}>binary · {preview.size} bytes</PreviewFrame>;
    case 'editing':
      return (
        <PreviewFrame
          name={preview.name}
          note="writable"
          tall
          actions={
            <>
              <button
                type="button"
                onClick={actions.cancel}
                disabled={preview.saving}
                className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void actions.save(); }}
                disabled={preview.saving || !preview.dirty}
                className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
              >
                {preview.saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {preview.error !== null && (
            <p className="border-b border-line px-2 py-1 font-mono text-[11px] text-err">{preview.error}</p>
          )}
          <textarea
            value={preview.value}
            onChange={(event) => { actions.editValue(event.target.value); }}
            disabled={preview.saving}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent p-2 font-mono text-[12px] leading-relaxed text-ink outline-none disabled:opacity-60"
          />
        </PreviewFrame>
      );
    case 'error':
      return (
        <PreviewFrame
          name={preview.name}
          actions={
            <button
              type="button"
              onClick={actions.dismiss}
              className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5"
            >
              Close
            </button>
          }
        >
          <p className="px-2 py-1 font-mono text-[11px] break-words text-err">{preview.message}</p>
        </PreviewFrame>
      );
    default:
      return assertNever(preview);
  }
}

/** The read-only ⇄ writable switch: an "Edit" pill, shown only when editable. */
function EditToggle({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Edit this file"
      className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5"
    >
      Edit
    </button>
  );
}

function PreviewFrame({
  name,
  note,
  tall,
  actions,
  children,
}: {
  name: string;
  note?: string | null;
  tall?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      aria-label="Preview"
      className={`flex ${tall ? 'max-h-[75%]' : 'max-h-[45%]'} min-h-0 flex-col border-t border-line`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-1">
        <span className="truncate font-mono text-[11px] text-ink">{name}</span>
        {note != null && (
          <span className={`text-[10px] tracking-wider uppercase ${note === 'writable' ? 'text-accent' : 'text-ink-dim'}`}>
            {note}
          </span>
        )}
        {actions != null && <span className="ml-auto flex shrink-0 items-center gap-2">{actions}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-auto text-[11px] text-ink-dim">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function ToolbarButton({ children, onClick }: { children: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5"
    >
      {children}
    </button>
  );
}

function Hint({ children }: { children: ReactNode }): ReactElement {
  return <p className="px-2 py-2 text-[11px] text-ink-dim">{children}</p>;
}

function DirError({ message, onRetry }: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div className="flex flex-col items-start gap-2 px-2 py-2">
      <p className="font-mono text-[11px] break-words text-err">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
      >
        Retry
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                     */
/* -------------------------------------------------------------------------- */

/** The inline name prompt for create / rename (spec-04 §"Web client"). */
function NameDialog({
  title,
  confirmLabel,
  initial,
  error,
  onSubmit,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  initial: string;
  error: string | null;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(initial);
  const name = value.trim();
  const valid = isValidName(name);

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

/** The delete confirmation; a folder delete warns, because it is recursive. */
function ConfirmDialog({
  entry,
  error,
  onConfirm,
  onCancel,
}: {
  entry: Confirm;
  error: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  return (
    <Overlay label="Confirm delete">
      <h3 className="text-sm font-semibold text-ink">Delete {entry.name}?</h3>
      {entry.isDirectory && (
        <p className="mt-2 text-[12px] text-err">This deletes the folder and everything inside it.</p>
      )}
      <p className="mt-1 text-[12px] text-ink-dim">This cannot be undone.</p>
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
          type="button"
          onClick={() => { void onConfirm(); }}
          className="rounded bg-err px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90"
        >
          Delete
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ label, children }: { label: string; children: ReactNode }): ReactElement {
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

/** The two modals' shared shape. */
type Prompt =
  | { mode: 'create-file' }
  | { mode: 'create-folder' }
  | { mode: 'rename'; path: string; initial: string };

interface Confirm {
  path: string;
  name: string;
  isDirectory: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
