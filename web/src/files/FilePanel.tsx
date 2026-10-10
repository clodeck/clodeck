import type { FileEntry, Project } from '@clodeck/shared';
import { useRef, useState, type ChangeEvent, type DragEvent, type ReactElement, type ReactNode } from 'react';

import { assertNever, breadcrumb, isValidName, joinPath, viewerPath, type PreviewState } from './reducer';
import { useFiles, type FileViewer, type FileViewerActions } from './useFiles';

/**
 * The file drawer — the view half of `useFiles`. It is keyed by project id in
 * `App` (like `ChatPanel` / `TerminalPanel`), so switching projects remounts a
 * fresh drawer rather than carrying one project's path and preview into another.
 *
 * Two rules are load-bearing, not style:
 *
 * - File bytes are rendered **only** as React text nodes (`<pre>{content}</pre>`);
 *   there is no `innerHTML` and no `dangerouslySetInnerHTML` anywhere, because a
 *   file's bytes are untrusted.
 * - Every renderer over a closed union is an exhaustive `switch` ending in
 *   {@link assertNever}, so a new entry type or content kind is a compile error.
 */

export function FilePanel({ project }: { project: Project }): ReactElement {
  const { viewer, actions } = useFiles(project);
  const dir = viewerPath(viewer);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const uploadFiles = (files: readonly File[]): void => {
    for (const file of files) void actions.upload(joinPath(dir, file.name), file);
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

  const submitPrompt = (name: string): void => {
    if (prompt === null) return;
    if (prompt.mode === 'rename') void actions.rename(prompt.path, name);
    else void actions.create(prompt.mode === 'create-file' ? 'file' : 'directory', name);
    setPrompt(null);
  };

  return (
    <section className="relative flex min-h-0 flex-col" aria-label="Files">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-dim uppercase">Files</h2>
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => { setPrompt({ mode: 'create-file' }); }}>New File</ToolbarButton>
          <ToolbarButton onClick={() => { setPrompt({ mode: 'create-folder' }); }}>New Folder</ToolbarButton>
          <ToolbarButton onClick={() => { fileInput.current?.click(); }}>Upload</ToolbarButton>
          <ToolbarButton onClick={actions.refresh}>Refresh</ToolbarButton>
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

      <Breadcrumb project={project} path={dir} onOpen={actions.open} onUp={actions.up} />

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
        onDragOver={(event) => { event.preventDefault(); }}
        onDrop={onDrop}
      >
        <ViewerBody
          viewer={viewer}
          dir={dir}
          menu={menu}
          actions={actions}
          onMenu={setMenu}
          onRename={(path, initial) => { setMenu(null); setPrompt({ mode: 'rename', path, initial }); }}
          onDelete={(entry) => { setMenu(null); setConfirm(entry); }}
        />
      </div>

      {viewer.status === 'ready' && viewer.preview.kind !== 'none' && <PreviewPane preview={viewer.preview} />}

      {prompt !== null && (
        <NameDialog
          title={prompt.mode === 'rename' ? 'Rename' : prompt.mode === 'create-file' ? 'New file' : 'New folder'}
          confirmLabel={prompt.mode === 'rename' ? 'Rename' : 'Create'}
          initial={prompt.mode === 'rename' ? prompt.initial : ''}
          onSubmit={submitPrompt}
          onCancel={() => { setPrompt(null); }}
        />
      )}

      {confirm !== null && (
        <ConfirmDialog
          entry={confirm}
          onConfirm={() => { void actions.remove(confirm.path); setConfirm(null); }}
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
  dir,
  menu,
  actions,
  onMenu,
  onRename,
  onDelete,
}: {
  viewer: FileViewer;
  dir: string;
  menu: string | null;
  actions: FileViewerActions;
  onMenu: (name: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  switch (viewer.status) {
    case 'idle':
      return <Hint>Select a project to browse its files.</Hint>;
    case 'loading':
      return <Hint>Loading…</Hint>;
    case 'error':
      return (
        <div className="flex flex-col items-start gap-2 px-2 py-2">
          <p className="font-mono text-[11px] break-words text-err">{viewer.message}</p>
          <button
            type="button"
            onClick={actions.refresh}
            className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5"
          >
            Retry
          </button>
        </div>
      );
    case 'ready':
      return (
        <Listing
          entries={viewer.entries}
          dir={dir}
          menu={menu}
          onOpen={actions.open}
          onPreview={actions.preview}
          onMenu={onMenu}
          onRename={onRename}
          onDelete={onDelete}
        />
      );
    default:
      return assertNever(viewer);
  }
}

function Listing({
  entries,
  dir,
  menu,
  onOpen,
  onPreview,
  onMenu,
  onRename,
  onDelete,
}: {
  entries: FileEntry[];
  dir: string;
  menu: string | null;
  onOpen: (path: string) => void;
  onPreview: (path: string) => void;
  onMenu: (name: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  if (entries.length === 0) return <Hint>This folder is empty.</Hint>;

  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <EntryRow
          key={entry.name}
          entry={entry}
          dir={dir}
          menuOpen={menu === entry.name}
          onOpen={onOpen}
          onPreview={onPreview}
          onMenu={onMenu}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* One row                                                                    */
/* -------------------------------------------------------------------------- */

function EntryRow({
  entry,
  dir,
  menuOpen,
  onOpen,
  onPreview,
  onMenu,
  onRename,
  onDelete,
}: {
  entry: FileEntry;
  dir: string;
  menuOpen: boolean;
  onOpen: (path: string) => void;
  onPreview: (path: string) => void;
  onMenu: (name: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const path = joinPath(dir, entry.name);

  return (
    <li className="relative flex items-center gap-1 rounded hover:bg-white/5">
      <EntryMain entry={entry} path={path} onOpen={onOpen} onPreview={onPreview} />
      <button
        type="button"
        aria-label={`Actions for ${entry.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => { onMenu(menuOpen ? null : entry.name); }}
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
    </li>
  );
}

function EntryMain({
  entry,
  path,
  onOpen,
  onPreview,
}: {
  entry: FileEntry;
  path: string;
  onOpen: (path: string) => void;
  onPreview: (path: string) => void;
}): ReactElement {
  switch (entry.type) {
    case 'directory':
      return (
        <RowButton onClick={() => { onOpen(path); }} title={`Open ${entry.name}`}>
          <span className="text-ink-dim">▸ </span>
          {entry.name}/
        </RowButton>
      );
    case 'file':
      return (
        <RowButton onClick={() => { onPreview(path); }} title={`Preview ${entry.name}`}>
          <span className="text-ink-dim">· </span>
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
/* Breadcrumb + preview                                                       */
/* -------------------------------------------------------------------------- */

function Breadcrumb({
  project,
  path,
  onOpen,
  onUp,
}: {
  project: Project;
  path: string;
  onOpen: (path: string) => void;
  onUp: () => void;
}): ReactElement {
  const crumbs = breadcrumb(path);

  return (
    <nav aria-label="Path" className="flex items-center gap-1 border-b border-line px-3 py-1 text-[11px] text-ink-dim">
      <button
        type="button"
        onClick={onUp}
        disabled={path === ''}
        aria-label="Up one level"
        className="rounded border border-line px-1.5 py-0.5 hover:bg-white/5 disabled:opacity-40"
      >
        ↑ Up
      </button>
      <button
        type="button"
        onClick={() => { onOpen(''); }}
        className="truncate rounded px-1 py-0.5 hover:text-ink"
        title={`Project root (${project.name})`}
      >
        {project.name}
      </button>
      {crumbs.map((crumb) => (
        <span key={crumb.path} className="flex min-w-0 items-center gap-1">
          <span className="text-ink-dim/60">/</span>
          <button
            type="button"
            onClick={() => { onOpen(crumb.path); }}
            className="truncate rounded px-1 py-0.5 hover:text-ink"
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function PreviewPane({ preview }: { preview: PreviewState }): ReactElement | null {
  switch (preview.kind) {
    case 'none':
      return null;
    case 'loading':
      return <PreviewFrame name={preview.name}>Loading…</PreviewFrame>;
    case 'text':
      return (
        <PreviewFrame name={preview.name} note={preview.truncated ? 'truncated' : null}>
          {/* A file's bytes are untrusted: they are a React text node, never HTML. */}
          <pre className="overflow-auto p-2 font-mono text-[11px] whitespace-pre text-ink">{preview.content}</pre>
        </PreviewFrame>
      );
    case 'binary':
      return <PreviewFrame name={preview.name}>binary · {preview.size} bytes</PreviewFrame>;
    default:
      return assertNever(preview);
  }
}

function PreviewFrame({
  name,
  note,
  children,
}: {
  name: string;
  note?: string | null;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-label="Preview" className="flex max-h-[45%] min-h-0 flex-col border-t border-line">
      <header className="flex items-center gap-2 border-b border-line px-3 py-1">
        <span className="truncate font-mono text-[11px] text-ink">{name}</span>
        {note != null && <span className="text-[10px] tracking-wider text-ink-dim uppercase">{note}</span>}
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

/* -------------------------------------------------------------------------- */
/* Modals                                                                     */
/* -------------------------------------------------------------------------- */

/** The inline name prompt for create / rename (spec-04 §"Web client"). */
function NameDialog({
  title,
  confirmLabel,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  initial: string;
  onSubmit: (name: string) => void;
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
          if (valid) onSubmit(name);
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
  onConfirm,
  onCancel,
}: {
  entry: Confirm;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <Overlay label="Confirm delete">
      <h3 className="text-sm font-semibold text-ink">Delete {entry.name}?</h3>
      {entry.isDirectory && (
        <p className="mt-2 text-[12px] text-err">This deletes the folder and everything inside it.</p>
      )}
      <p className="mt-1 text-[12px] text-ink-dim">This cannot be undone.</p>
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
