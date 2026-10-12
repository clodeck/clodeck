import { MAX_UPLOAD_MB, type FileEntry, type Project } from '@clodeck/shared';
import { useRef, useState, type ChangeEvent, type DragEvent, type ReactElement, type ReactNode } from 'react';

import { useToast } from '../toast/ToastProvider';
import { formatModified, formatSize } from './format';
import { assertNever, isValidName, joinPath, noPreview, previewPath, type DirListing } from './reducer';
import { summarizeUploads } from './upload';
import { useFiles, type FileViewer, type FileViewerActions, type PreviewState } from './useFiles';

/**
 * The file panel — the view half of `useFiles`. It is keyed by project id in
 * `App`'s drawer (like `ChatPanel` / `TerminalPanel`), so switching projects
 * remounts a fresh panel rather than carrying one project's tree and preview
 * into another.
 *
 * It is laid out as two columns, `300px` of tree and a code view that takes the
 * rest: the tree is the navigator and owns the toolbar and the breadcrumb, the
 * code column owns the open file — its path in the head, its bytes (or its
 * editor) in the body. Neither column grows the other: both are `min-h-0` and
 * scroll on their own, because the panel lives inside a fixed-height drawer.
 *
 * The tree keeps its old behaviour: folders expand in place (a click toggles
 * them, it never navigates), each expanded folder's listing is fetched lazily on
 * first open, and the last folder clicked is the "active" folder that New
 * File/Folder and Upload land in. The preview starts **read-only** and flips to
 * a writable `<textarea>` with Save/Cancel — the content-editing toggle. Each
 * file row carries its size, with the modified time a hover away; a directory
 * row carries nothing, because the wire carries nothing for one.
 *
 * Uploads arrive two ways — the toolbar's picker and a drop anywhere on the
 * panel — and both are one batch: every file is sent, the batch reports itself
 * **once** when all of it has settled, and a file over the shared cap is refused
 * before it becomes a request. The drop overlay is where that cap is said, while
 * the drag is still in the air rather than after a 300 MB body has failed.
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
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const toast = useToast();

  // The folder create/upload land in, read off the view model: `''` is the root.
  const activeDir = viewer.status === 'ready' ? viewer.active : '';
  const activeLabel = viewer.status === 'ready' ? (viewer.active === '' ? 'root' : viewer.active) : null;
  // The code column's state, which is `none` until a file is opened and whenever
  // the tree itself has nothing to show.
  const preview = viewer.status === 'ready' ? viewer.preview : noPreview;

  /**
   * Upload a picked or dropped batch. Every file goes, and the batch speaks
   * **once** when it has all settled: one message with the counts, and the first
   * failure's reason under it — a five-file drop that lost two says so instead of
   * looking like a clean one, and two failures do not stomp each other's notice.
   */
  const uploadFiles = (files: readonly File[]): void => {
    void actions.upload(files).then((outcomes) => {
      const summary = summarizeUploads(outcomes);
      if (summary !== null) toast(summary.message, summary.detail ?? undefined);
    });
  };

  const onChosen = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (files !== null) uploadFiles(Array.from(files));
    // Reset so picking the same file again still fires `change`.
    event.target.value = '';
  };

  /**
   * The panel is one drop target: the overlay is `pointer-events-none`, so a drag
   * that passes over it still reaches this element. Only a drag carrying OS files
   * is an upload — an internal row drag for a move (ticket 44) carries
   * `text/plain` and must leave the tree alone.
   */
  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!hasOsFiles(event)) return;
    event.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>): void => {
    // Moving between the panel's own children is not leaving the panel.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    if (!hasOsFiles(event)) return;
    event.preventDefault();
    setDragActive(false);
    uploadFiles(Array.from(event.dataTransfer.files));
  };

  const submitPrompt = async (name: string): Promise<void> => {
    if (prompt === null) return;
    // The prototype's vocabulary, root included: it says nothing about the root,
    // because a bare `file x created` already says the whole of it.
    const inDir = activeDir === '' ? '' : ` in ${activeDir}`;
    try {
      if (prompt.mode === 'rename') {
        await actions.rename(prompt.path, name);
        toast(`renamed to ${name}`);
      } else if (prompt.mode === 'create-file') {
        await actions.create('file', name);
        toast(`file ${name} created${inDir}`);
      } else {
        await actions.create('directory', name);
        toast(`folder ${name} created${inDir}`);
      }
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
      toast(`deleted ${confirm.name}`);
      setConfirm(null);
      setConfirmError(null);
    } catch (error) {
      setConfirmError(messageOf(error));
    }
  };

  return (
    <section
      className="relative flex min-h-0 flex-1"
      aria-label="Files"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* The tree column: the toolbar and the breadcrumb it acts in, then the
          tree itself. It is the only column with a fixed width. */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
        {/* The breadcrumb gets its own line: four labelled buttons plus a path do
            not fit across 300px, and a squeezed path is the one thing here the
            reader cannot do without (it is where new file/folder land). */}
        <header className="shrink-0 border-b border-line px-3 py-2">
          {activeLabel !== null && (
            <p
              className="truncate font-mono text-[11px] text-ink-dim"
              title={`New file, new folder and upload land in: ${activeLabel}`}
            >
              in {activeLabel}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <ToolbarButton onClick={() => { setPrompt({ mode: 'create-file' }); setPromptError(null); }}>New File</ToolbarButton>
            <ToolbarButton onClick={() => { setPrompt({ mode: 'create-folder' }); setPromptError(null); }}>New Folder</ToolbarButton>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <ViewerBody
            viewer={viewer}
            menu={menu}
            actions={actions}
            onMenu={setMenu}
            onRename={(path, initial) => { setMenu(null); setPrompt({ mode: 'rename', path, initial }); setPromptError(null); }}
            onDelete={(entry) => { setMenu(null); setConfirm(entry); setConfirmError(null); }}
          />
        </div>
      </div>

      {/* The code column: the open file's path in the head, its bytes in the
          body. The head's right-hand side is the file's action area — today the
          edit toggle, and where download (42) and preview (43) will land. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <CodeHead preview={preview} actions={actions} />
        <div className="min-h-0 flex-1 overflow-auto">
          <PreviewBody preview={preview} actions={actions} />
        </div>
      </div>

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

      {dragActive && <DropOverlay />}
    </section>
  );
}

/**
 * Where a dropped batch will land, and the size it has to be under. The cap is
 * named here on purpose: a drop that is going to be refused should say so while
 * it is still being dragged, not after a 300 MB upload has run its course.
 */
function DropOverlay(): ReactElement {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 m-1 flex items-center justify-center rounded border-2 border-dashed border-accent bg-canvas/85"
      aria-hidden="true"
    >
      <p className="rounded bg-panel px-3 py-1 font-mono text-[12px] text-accent">
        Drop files to upload · max {MAX_UPLOAD_MB} MB
      </p>
    </div>
  );
}

/** Whether a drag is carrying OS files — the only kind that is an upload. */
function hasOsFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
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
    // `relative`, so the row's own menu is placed against the row. Without it
    // the menu's containing block is the whole panel, `top-full` puts it below
    // the panel, and the tree's scroller clips it away — the `⋯` opens nothing.
    // The row carries the file's modified time as its tooltip: a title on the
    // size alone would be a hover on a few characters, and the name's own title
    // (`Preview x`) still wins where it has one.
    <div
      className={`relative flex items-center gap-1 rounded hover:bg-white/5 ${isActive ? 'bg-white/5' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={entry.type === 'file' ? modifiedTitle(entry.mtime) : undefined}
    >
      <EntryMain
        entry={entry}
        isExpanded={isExpanded}
        onClick={isDir ? () => actions.toggle(path) : () => actions.preview(path)}
      />
      {entry.type === 'file' && <FileMeta size={entry.size} />}
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

/**
 * A file row's size, dim and at the row's right edge — the one thing the row
 * shows about the bytes. Only a file gets one: a directory's row is passed no
 * `size` by the wire type, so it renders blank rather than a number nothing
 * measured (the prototype's directory numbers were a hash of the name).
 */
function FileMeta({ size }: { size: number }): ReactElement {
  return <span className="shrink-0 font-mono text-[10px] text-ink-dim">{formatSize(size)}</span>;
}

/** When a file last changed: the relative form, then the server's exact timestamp. */
function modifiedTitle(mtime: string): string {
  return `modified ${formatModified(mtime, Date.now())} · ${mtime}`;
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

/**
 * The code column's head: which file this column is showing, and what can be
 * done to it. `no file selected` is the empty column's own label — the panel has
 * no other empty state, so the head never disappears.
 */
function CodeHead({ preview, actions }: { preview: PreviewState; actions: FileViewerActions }): ReactElement {
  const path = previewPath(preview);

  return (
    <header className="flex items-center gap-2 border-b border-line px-3 py-1">
      {path === null ? (
        <span className="truncate font-mono text-[11px] text-ink-dim">no file selected</span>
      ) : (
        <span className="truncate font-mono text-[11px] text-ink" title={path}>
          {path}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <CodeActions preview={preview} actions={actions} />
      </span>
    </header>
  );
}

/** The open file's controls — the right-hand half of the code head. */
function CodeActions({
  preview,
  actions,
}: {
  preview: PreviewState;
  actions: FileViewerActions;
}): ReactElement | null {
  switch (preview.kind) {
    case 'none':
    case 'loading':
    case 'binary':
      return null;
    case 'text':
      return (
        <>
          <Note>{preview.truncated ? 'truncated' : 'read-only'}</Note>
          {/* A truncated file holds only the 256 KiB prefix; editing it would
              clobber the rest, so the writable toggle is withheld. */}
          {preview.truncated ? null : <EditToggle onClick={actions.edit} />}
        </>
      );
    case 'editing':
      return (
        <>
          <Note tone="accent">writable</Note>
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
      );
    case 'error':
      return (
        <button
          type="button"
          onClick={actions.dismiss}
          className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5"
        >
          Close
        </button>
      );
    default:
      return assertNever(preview);
  }
}

/** The code column's body: the file's bytes, or the editor over them. */
function PreviewBody({
  preview,
  actions,
}: {
  preview: PreviewState;
  actions: FileViewerActions;
}): ReactElement | null {
  switch (preview.kind) {
    case 'none':
      return null;
    case 'loading':
      return <Hint>Loading…</Hint>;
    case 'text':
      // A file's bytes are untrusted: they are a React text node, never HTML.
      return <pre className="p-2 font-mono text-[11px] whitespace-pre text-ink">{preview.content}</pre>;
    case 'binary':
      return (
        <p className="p-2 font-mono text-[11px] text-ink-dim">binary · {preview.size} bytes</p>
      );
    case 'editing':
      // A column so a save error takes its own line and the editor keeps the
      // rest of the height, rather than being pushed out of the drawer.
      return (
        <div className="flex h-full min-h-0 flex-col">
          {preview.error !== null && (
            <p className="border-b border-line px-2 py-1 font-mono text-[11px] text-err">{preview.error}</p>
          )}
          <textarea
            value={preview.value}
            onChange={(event) => { actions.editValue(event.target.value); }}
            disabled={preview.saving}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-[12px] leading-relaxed text-ink outline-none disabled:opacity-60"
          />
        </div>
      );
    case 'error':
      return <p className="px-2 py-1 font-mono text-[11px] break-words text-err">{preview.message}</p>;
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

function Note({ tone, children }: { tone?: 'accent'; children: ReactNode }): ReactElement {
  return (
    <span className={`text-[10px] tracking-wider uppercase ${tone === 'accent' ? 'text-accent' : 'text-ink-dim'}`}>
      {children}
    </span>
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
