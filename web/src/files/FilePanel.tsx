import { MAX_UPLOAD_MB, type FileEntry, type Project } from '@clodeck/shared';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

import { NameDialog, Overlay } from '../dialogs';
import { Icon, type IconName } from '../icons';
import { Name } from '../Name';
import { useToast } from '../toast/ToastProvider';
import { CodeView } from './code';
import { formatModified, formatSize } from './format';
import { isMarkdown, renderMarkdown } from './markdown';
import { MENU_GAP, menuPlacement, type MenuPlacement, type Span } from './placement';
import {
  assertNever,
  baseName,
  joinPath,
  nameRefusal,
  noPreview,
  parentPath,
  previewPath,
  type DirListing,
} from './reducer';
import { downloadUrl } from './transport';
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
 * a writable `<textarea>` with Save/Cancel — the content-editing toggle. A
 * markdown file also gets a `Preview ⇄ Source` toggle in the code head, which
 * reads the very bytes the server sent through `renderMarkdown` instead of
 * showing them as text; the file opens as its source, as the prototype's does.
 * Each file row carries its size, with the modified time a hover away; a
 * directory row carries nothing, because the wire carries nothing for one.
 *
 * The toolbar's `List` ⇄ `Tree` toggle swaps the tree for a flat list of **the
 * folder being shown** — this product lists one directory per request and has no
 * recursive listing route, so the flat view is one folder's entries with their
 * size and modified time, not the whole project flattened. The switch is
 * rendering only: both views read the same loaded listings, which is why the
 * open file and the current folder survive it. In the flat list a folder click
 * *enters* it (there is nothing to expand into) and the breadcrumb — a plain
 * `in <folder>` line in tree mode — becomes the way back up.
 *
 * Uploads arrive two ways — the toolbar's picker and a drop anywhere on the
 * panel — and both are one batch: every file is sent, the batch reports itself
 * **once** when all of it has settled, and a file over the shared cap is refused
 * before it becomes a request. The drop overlay is where that cap is said, while
 * the drag is still in the air rather than after a 300 MB body has failed.
 *
 * Two rules are load-bearing, not style:
 *
 * - File bytes are rendered **only** as React nodes this app builds itself — a
 *   `<pre>{content}</pre>`, a controlled `<textarea value>`, and the elements
 *   `renderMarkdown` makes out of a markdown file. There is no `innerHTML` and no
 *   `dangerouslySetInnerHTML` anywhere, because a file's bytes are untrusted.
 * - Every renderer over a closed union is an exhaustive `switch` ending in
 *   {@link assertNever}, so a new entry type or content kind is a compile error.
 */

export function FilePanel({ project }: { project: Project }): ReactElement {
  const { viewer, actions } = useFiles(project);
  /**
   * Which of the two listings the tree column is showing. It is panel state on
   * purpose — a `useState` here, like the open menu and the dialogs — so it dies
   * with the panel (which `App`'s drawer re-mounts per project) rather than
   * becoming a stored preference per project.
   */
  const [view, setView] = useState<View>('tree');
  /**
   * The markdown file whose *rendered* form is on screen, if any. It holds a
   * path rather than a flag because opening a file has to reset it: every file
   * opens as its source — the prototype's default, and the only thing a
   * non-markdown file ever gets — and the toggle shows the rendering for the file
   * it was clicked on.
   */
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  /**
   * Ticket 44's drag-to-move state: the row in the air, and the destination under
   * the pointer (`''` is the root). `dragging === null` is what tells every drop
   * target that the drag it is seeing is not an internal move — an OS-file drag
   * carries `Files` and belongs to the panel's own drop handler.
   */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  // The head and every row menu share one download action (ticket 78).
  const download: DownloadControl = {
    projectId: project.id,
    onDownloaded: (name) => { toast(`downloaded ${name}`); },
  };

  const moveControl: MoveControl = {
    dragging,
    over,
    onStart: setDragging,
    onEnd: () => { setDragging(null); setOver(null); },
    onHover: setOver,
    onDrop: (dest) => {
      if (dragging === null) return;
      // The drop ends the drag whether or not the move then happens, so nothing
      // is left highlighted behind a cancelled dialog.
      setDragging(null);
      setOver(null);
      setMenu(null);
      setMove({ path: dragging, name: baseName(dragging), dest });
      setMoveError(null);
    },
  };

  /**
   * Ticket 48: the tree's own listing area is a drop target for the root, not
   * just the breadcrumb's crumb. Ticket 44 left the root reachable through that
   * crumb alone — four characters, in a header the drag has to travel to, and
   * not where anyone aims: a row dropped on the empty tree below the last one
   * means "out to the root", and it landed on nothing. The rows stop their own
   * drops, so what reaches this element is exactly the drag that missed every
   * folder. **Tree only:** the flat list shows one folder rather than the root,
   * where the space between rows would have to mean that folder instead.
   *
   * It is a labelled `group` for a screen reader's sake and the tests' — an
   * `aria-label` on a bare `div` would be ignored, and an unlabelled area is not
   * something a drop can be aimed at by name.
   */
  const rootDropArea = view === 'tree'
    ? { role: 'group' as const, 'aria-label': 'Files tree', ...dropTarget(moveControl, '') }
    : {};
  const rootDropOver = view === 'tree' && over === '';

  // The folder create/upload land in, read off the view model: `''` is the root.
  const activeDir = viewer.status === 'ready' ? viewer.active : '';
  const activeLabel = viewer.status === 'ready' ? (viewer.active === '' ? 'root' : viewer.active) : null;
  // The create tooltips' `… in <folder>`, said once: the folder a create lands
  // in, and nothing while the listing is not ready to name one.
  const createIn = activeLabel === null ? '' : ` in ${activeLabel}`;
  // The code column's state, which is `none` until a file is opened and whenever
  // the tree itself has nothing to show.
  const preview = viewer.status === 'ready' ? viewer.preview : noPreview;
  // Whether the column is showing the rendered markdown rather than the source:
  // only ever for a markdown file, and only for as long as its toggle says so.
  const shown = previewPath(preview);
  const previewingMarkdown = shown !== null && isMarkdown(shown) && previewFor === shown;
  // Every file opens as its source: the mode is where you left it *for a file*,
  // not a column-wide setting that follows you into the next one.
  useEffect(() => { setPreviewFor(null); }, [shown]);
  const toggleMarkdown = (): void => { setPreviewFor(previewingMarkdown ? null : shown); };

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

  /**
   * The move the user just confirmed. A move into the folder the entry already
   * lives in is a no-op the client can see for itself, and the prototype refuses
   * it with a word rather than performing it — everything else goes to the
   * server, whose refusal (a collision, a folder into its own subtree) is the
   * dialog's to show.
   */
  const confirmMove = async (): Promise<void> => {
    if (move === null) return;
    if (parentPath(move.path) === move.dest) {
      toast(`already in ${folderLabel(move.dest)}`);
      setMove(null);
      return;
    }
    try {
      await actions.move(move.path, move.dest);
      toast(`moved ${move.name} → ${folderLabel(move.dest)}`);
      setMove(null);
      setMoveError(null);
    } catch (error) {
      setMoveError(messageOf(error));
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
        {/* The breadcrumb gets its own line: the toolbar is one row of five
            icons, and a squeezed path is the one thing here the reader cannot do
            without (it is where new file/folder land). */}
        <header className="shrink-0 border-b border-line px-3 py-2">
          {/* The trail to the folder create and upload land in — and, in the flat
              list, the way back up out of a folder. The tree reads the same trail
              (`root / … / here`) rather than the `in <folder>` line ticket 41
              left it: its root crumb is the one drop target a file dragged out
              of a subfolder has to get home to (ticket 44). */}
          {activeLabel !== null && (
            <Breadcrumb
              active={activeDir}
              onOpen={actions.openDir}
              move={moveControl}
              label={`New file, new folder and upload land in: ${activeLabel}`}
            />
          )}
          {/* Five icons on one line: the labels live in each button's name and
              tooltip, and the tooltip is where the context the old text buttons
              carried — the folder a create lands in, the upload cap, the view
              the toggle switches to — is said. The row is a labelled `group`,
              as the tree's drop area is, so the five actions are announced as
              one set rather than five loose buttons. */}
          <div role="group" aria-label="File actions" className="mt-1.5 flex items-center gap-1">
            <ToolbarButton
              icon="filePlus"
              label="New File"
              title={`New file${createIn}`}
              onClick={() => { setPrompt({ mode: 'create-file' }); setPromptError(null); }}
            />
            <ToolbarButton
              icon="folderPlus"
              label="New Folder"
              title={`New folder${createIn}`}
              onClick={() => { setPrompt({ mode: 'create-folder' }); setPromptError(null); }}
            />
            <ToolbarButton
              icon="upload"
              label="Upload"
              title={`Upload files (max ${String(MAX_UPLOAD_MB)} MB each)`}
              onClick={() => { fileInput.current?.click(); }}
            />
            <ToolbarButton icon="refresh" label="Refresh" title="Refresh the tree" onClick={actions.refresh} />
            <ToolbarButton
              icon={view === 'tree' ? 'list' : 'folder'}
              label={view === 'tree' ? 'List' : 'Tree'}
              title={view === 'tree' ? 'Flat list of this folder' : 'Tree view'}
              onClick={() => { setView(view === 'tree' ? 'list' : 'tree'); }}
            />
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

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-2 py-1 ${
            rootDropOver ? 'bg-white/5 outline-1 outline-accent' : ''
          }`}
          {...rootDropArea}
        >
          <ViewerBody
            view={view}
            viewer={viewer}
            menu={menu}
            actions={actions}
            moveControl={moveControl}
            download={download}
            onMenu={setMenu}
            onRename={(path, initial) => { setMenu(null); setPrompt({ mode: 'rename', path, initial }); setPromptError(null); }}
            onDelete={(entry) => { setMenu(null); setConfirm(entry); setConfirmError(null); }}
          />
        </div>
      </div>

      {/* The code column: the open file's path — or the selected folder's — in
          the head, its bytes in the body. The head's right-hand side is the
          selection's action area: download, the markdown mode switch, and the
          read-only ⇄ writable toggle. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <CodeHead
          active={activeDir}
          download={download}
          preview={preview}
          actions={actions}
          previewingMarkdown={previewingMarkdown}
          onToggleMarkdown={toggleMarkdown}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <PreviewBody preview={preview} actions={actions} previewingMarkdown={previewingMarkdown} />
        </div>
      </div>

      {prompt !== null && (
        <NameDialog
          title={prompt.mode === 'rename' ? 'Rename' : prompt.mode === 'create-file' ? 'New file' : 'New folder'}
          confirmLabel={prompt.mode === 'rename' ? 'Rename' : 'Create'}
          initial={prompt.mode === 'rename' ? prompt.initial : ''}
          error={promptError}
          refusal={nameRefusal}
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

      {move !== null && (
        <MoveDialog
          request={move}
          error={moveError}
          onConfirm={confirmMove}
          onCancel={() => { setMove(null); }}
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

/**
 * A move the user has asked for and not yet confirmed. `dest` is a root-relative
 * directory path (`''` is the root) — the folder the row was dropped on.
 */
interface MoveRequest {
  path: string;
  name: string;
  dest: string;
}

/**
 * The drag-a-file-onto-a-folder wiring (ticket 44), handed to every folder row
 * and to the breadcrumb's root crumb. `dragging` is the row in the air and `over`
 * the destination under the pointer; `dragging === null` is how a drop target
 * tells an internal move from the OS-file drag the panel itself handles.
 */
interface MoveControl {
  dragging: string | null;
  over: string | null;
  onStart(path: string): void;
  onEnd(): void;
  onHover(path: string | null): void;
  onDrop(dest: string): void;
}

/**
 * The download action the code head and every row menu share (ticket 78): the
 * project the route sits under, and the one toast a download speaks through.
 * The saved name is derived beside it — `<name>` for a file, `<name>.zip` for a
 * folder — the same rule the server's disposition applies, so the two ends
 * cannot name one download differently.
 */
interface DownloadControl {
  projectId: string;
  onDownloaded(name: string): void;
}

/**
 * Pick a file row up. Only `text/plain` is set — the prototype's own choice, and
 * load-bearing here: a drag advertising `Files` would read as an OS-file upload
 * to the panel's drop handler (ticket 38), and the two must never collide.
 */
function startDrag(event: DragEvent<HTMLElement>, path: string, move: MoveControl): void {
  event.dataTransfer.setData('text/plain', path);
  event.dataTransfer.effectAllowed = 'move';
  move.onStart(path);
}

/**
 * Whether `dest` is the dragged entry itself or a folder inside it. Now that a
 * folder can be picked up, its own row and every folder beneath it are drop
 * targets by position but not by meaning — the server refuses both ("a
 * directory cannot be moved into itself"), and letting the drag through would
 * also bubble a miss to the tree's root area and silently mean "move to root".
 */
function insideDragged(dragged: string, dest: string): boolean {
  return dest === dragged || dest.startsWith(`${dragged}/`);
}

/**
 * A drop target's drag props: a folder row, or the breadcrumb's root crumb. A
 * drag that is not an internal move is left alone entirely, so the panel's own
 * drop handling — and the browser's default for a text drag — are untouched.
 */
function dropTarget(
  move: MoveControl,
  dest: string,
): Pick<HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'> {
  return {
    onDragOver: (event) => {
      if (move.dragging === null) return;
      // Swallowed rather than declined: the root area is an ancestor, and a
      // declined event would reach it and turn "onto itself" into "to root".
      // `preventDefault` is still needed to claim the drop so it lands here,
      // where the matching `onDrop` can discard it.
      if (insideDragged(move.dragging, dest)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      move.onHover(dest);
    },
    onDragLeave: (event) => {
      if (move.over !== dest) return;
      // Moving between the target's own children is not leaving it.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      move.onHover(null);
    },
    onDrop: (event) => {
      if (move.dragging === null) return;
      if (insideDragged(move.dragging, dest)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      move.onDrop(dest);
    },
  };
}

/** How a destination folder reads in a message: the root has a name of its own. */
function folderLabel(dest: string): string {
  return dest === '' ? 'root' : dest;
}

/**
 * The listing the tree column is showing. Not persisted, not per project — the
 * panel is re-mounted per project and this dies with it.
 */
type View = 'tree' | 'list';

/**
 * The columns of the flat list, one grid for the head and for every row, so the
 * head's labels sit over the cells they name. `minmax(0,1fr)` lets a long name
 * truncate instead of pushing the numbers off the row.
 */
const LIST_GRID = 'grid grid-cols-[minmax(0,1fr)_4rem_5rem_1.5rem] items-center gap-1';

/* -------------------------------------------------------------------------- */
/* The body, dispatched on the viewer's status                                */
/* -------------------------------------------------------------------------- */

function ViewerBody({
  view,
  viewer,
  menu,
  actions,
  moveControl,
  download,
  onMenu,
  onRename,
  onDelete,
}: {
  view: View;
  viewer: FileViewer;
  menu: string | null;
  actions: FileViewerActions;
  moveControl: MoveControl;
  download: DownloadControl;
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
      // The same loaded tree either way: the toggle changes the rendering, never
      // what has been fetched, which is what keeps the open file and the current
      // folder across a flip. Only the tree carries a move: its rows are the ones
      // you can pick up and drop (the flat list is a listing, not a navigator).
      return view === 'list' ? (
        <FlatList
          dir={viewer.active}
          dirs={viewer.dirs}
          menu={menu}
          actions={actions}
          download={download}
          onMenu={onMenu}
          onRename={onRename}
          onDelete={onDelete}
        />
      ) : (
        <TreeLevel
          path=""
          depth={0}
          dirs={viewer.dirs}
          expanded={viewer.expanded}
          active={viewer.active}
          menu={menu}
          actions={actions}
          moveControl={moveControl}
          download={download}
          onMenu={onMenu}
          onRename={onRename}
          onDelete={onDelete}
        />
      );
    default:
      return assertNever(viewer);
  }
}

/**
 * The four states one directory's listing can be in, which both listings share:
 * a folder whose listing has not been fetched yet reads as loading, a fetch in
 * flight reads as loading, a failed fetch says why and offers a retry, and a
 * listing with no entries in it is the caller's own emptiness (`depth`-dependent
 * in the tree, one line in the flat list). Only the ready state differs between
 * the two views, so it is the one the caller supplies.
 */
function ListingBody({
  listing,
  actions,
  empty,
  ready,
}: {
  listing: DirListing | undefined;
  actions: FileViewerActions;
  empty: ReactElement;
  ready: (entries: FileEntry[]) => ReactElement;
}): ReactElement {
  if (listing === undefined) return <Hint>Loading…</Hint>;

  switch (listing.status) {
    case 'loading':
      return <Hint>Loading…</Hint>;
    case 'error':
      return <DirError message={listing.message} onRetry={actions.refresh} />;
    case 'ready':
      return listing.entries.length === 0 ? empty : ready(listing.entries);
    default:
      return assertNever(listing);
  }
}

/* -------------------------------------------------------------------------- */
/* The flat list                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One folder's entries as rows with columns — the same listing the tree is
 * showing, one folder of it, which is all this product lists per request.
 *
 * A folder row here **opens** that folder (the same thing a folder click does in
 * the tree) instead of expanding it: there is nothing to expand into. A file row
 * opens the file, and both rows keep the `⋯` menu.
 */
function FlatList({
  dir,
  dirs,
  menu,
  actions,
  download,
  onMenu,
  onRename,
  onDelete,
}: {
  dir: string;
  dirs: Record<string, DirListing>;
  menu: string | null;
  actions: FileViewerActions;
  download: DownloadControl;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const listing = dirs[dir];
  return (
    <ListingBody
      listing={listing}
      actions={actions}
      empty={<Hint>This folder is empty.</Hint>}
      ready={(entries) => (
        <>
          <div className={LIST_GRID}>
            <span className="font-mono text-[10px] tracking-wider text-ink-dim uppercase">Name</span>
            <span className="text-right font-mono text-[10px] tracking-wider text-ink-dim uppercase">Size</span>
            <span className="text-right font-mono text-[10px] tracking-wider text-ink-dim uppercase">Modified</span>
            {/* The rows' `⋯` column: the head names the three things a row carries. */}
            <span />
          </div>
          <ul className="flex flex-col">
            {entries.map((entry) => {
              const path = joinPath(dir, entry.name);
              return (
                <li key={path}>
                  <FlatRow
                    entry={entry}
                    path={path}
                    menuOpen={menu === path}
                    actions={actions}
                    download={download}
                    onMenu={onMenu}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    />
  );
}

/** One flat row: the name, the two measurements a file carries, and its menu. */
function FlatRow({
  entry,
  path,
  menuOpen,
  actions,
  download,
  onMenu,
  onRename,
  onDelete,
}: {
  entry: FileEntry;
  path: string;
  menuOpen: boolean;
  actions: FileViewerActions;
  download: DownloadControl;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const isDir = entry.type === 'directory';

  return (
    // `relative` for the same reason the tree row has it: the menu is placed
    // against its own row, not against the panel.
    <div
      className={`${LIST_GRID} relative rounded hover:bg-bg-2`}
      title={entry.type === 'file' ? modifiedTitle(entry.mtime) : undefined}
    >
      <EntryMain
        entry={entry}
        view="list"
        isExpanded={false}
        onClick={isDir ? () => { actions.openDir(path); } : () => { actions.preview(path); }}
      />
      {/* A folder has neither on the wire, so both cells stay empty rather than
          showing a number nothing measured. */}
      <Cell>{entry.type === 'file' ? formatSize(entry.size) : ''}</Cell>
      <Cell>{entry.type === 'file' ? formatModified(entry.mtime, Date.now()) : ''}</Cell>
      <EntryActions
        entry={entry}
        path={path}
        menuOpen={menuOpen}
        download={download}
        onMenu={onMenu}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

/** One measurement cell — right-aligned, dim, monospace, like the tree's size. */
function Cell({ children }: { children: ReactNode }): ReactElement {
  return <span className="truncate text-right font-mono text-[10px] text-ink-dim">{children}</span>;
}

/**
 * The trail to the folder on screen, from the root down, with every folder above
 * the current one a step to it. It is shown in both listings: in the flat list
 * it is the only way back up out of a folder (there is nothing to collapse), and
 * in the tree it is where create and upload land — and the **root crumb is a
 * drop target**, which is the one place a file dragged out of a subfolder has to
 * get home to (ticket 44).
 */
function Breadcrumb({
  active,
  onOpen,
  move,
  label,
}: {
  active: string;
  onOpen: (path: string) => void;
  move: MoveControl;
  label: string;
}): ReactElement {
  return (
    <nav
      aria-label="Folder"
      title={label}
      className="flex flex-wrap items-center gap-1 font-mono text-[11px]"
    >
      {crumbsOf(active).map((crumb, index) => {
        // Only the root: an ancestor folder is a step *along* the trail, and a
        // drop on one of those would be a drop on the wrong folder.
        const drop = crumb === '' ? dropTarget(move, '') : {};
        const hovering = crumb === '' && move.over === '';
        return (
          <Fragment key={crumb}>
            {index > 0 && <span className="text-ink-dim">/</span>}
            {crumb === active ? (
              <span
                className={`truncate rounded px-0.5 text-ink ${hovering ? 'bg-white/5 outline-1 outline-accent' : ''}`}
                aria-current="true"
                {...drop}
              >
                {crumbLabel(crumb)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => { onOpen(crumb); }}
                className={`truncate rounded px-0.5 text-ink-dim hover:text-accent ${hovering ? 'bg-white/5 outline-1 outline-accent' : ''}`}
                {...drop}
              >
                {crumbLabel(crumb)}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/** The root, then every ancestor of `dir` down to `dir` itself. */
function crumbsOf(dir: string): string[] {
  if (dir === '') return [''];
  const segments = dir.split('/');
  return ['', ...segments.map((_segment, index) => segments.slice(0, index + 1).join('/'))];
}

function crumbLabel(path: string): string {
  return path === '' ? 'root' : baseName(path);
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
  moveControl,
  download,
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
  moveControl: MoveControl;
  download: DownloadControl;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  return (
    <ListingBody
      listing={dirs[path]}
      actions={actions}
      // Only the root says the folder is empty; a nested empty one is a folder
      // that happens to hold nothing, and the tree shows that by not opening it.
      empty={depth === 0 ? <Hint>This folder is empty.</Hint> : <span />}
      ready={(entries) => (
        <ul className="flex flex-col">
          {entries.map((entry) => {
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
                  moveControl={moveControl}
                  download={download}
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
                    moveControl={moveControl}
                    download={download}
                    onMenu={onMenu}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    />
  );
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
  moveControl,
  download,
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
  moveControl: MoveControl;
  download: DownloadControl;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const isDir = entry.type === 'directory';
  // The folder under a dragged row takes the prototype's outline. The row keeps
  // its `relative` for the menu's sake (see below), so this is a second class
  // rather than a wrapper.
  const hovering = isDir && moveControl.over === path;
  /**
   * The row's tone, on the shell's surface scale (ticket 49). One source for it
   * rather than three classes stacked: a drop target is `bg-2` (the prototype's
   * `.tree-row.drop-target`), the open/active row is `bg-3` (`.on`), and a plain
   * row steps up to `bg-2` on hover. An active row therefore keeps its tone
   * under the cursor — `hover:bg-2` would win on specificity and make the row
   * look *less* current the moment the pointer reached it, which is the
   * prototype's own ordering (`.tree-row:hover` at `styles.css:199`, `.on` at
   * `:200`).
   */
  const tone = hovering ? 'bg-bg-2 outline-1 outline-accent' : isActive ? 'bg-bg-3' : 'hover:bg-bg-2';

  return (
    // `relative`, so the row's own menu is placed against the row. Without it
    // the menu's containing block is the whole panel, `top-full` puts it below
    // the panel, and the tree's scroller clips it away — the `⋯` opens nothing.
    // Ticket 55 leans on the same block: the menu still hangs off this row when
    // it opens upward, so `EntryActions` measures the row and not the panel.
    // The row carries the file's modified time as its tooltip: a title on the
    // size alone would be a hover on a few characters, and the name's own title
    // (`Preview x`) still wins where it has one.
    //
    // Every row is draggable and a **folder** row is also a drop target (ticket
    // 44, widened here): a file was the only row that could be picked up, so a
    // folder inside a folder had no way out to the root. The drag carries
    // `text/plain` and nothing else: a drag advertising `Files` would be read as
    // an upload by the panel's own drop handler.
    <div
      className={`relative flex items-center gap-1 rounded ${tone}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={entry.type === 'file' ? modifiedTitle(entry.mtime) : undefined}
      draggable
      onDragStart={(event) => { startDrag(event, path, moveControl); }}
      onDragEnd={() => { moveControl.onEnd(); }}
      {...(isDir ? dropTarget(moveControl, path) : {})}
    >
      <EntryMain
        entry={entry}
        view="tree"
        isExpanded={isExpanded}
        onClick={isDir ? () => actions.toggle(path) : () => actions.preview(path)}
      />
      {entry.type === 'file' && <FileMeta size={entry.size} />}
      <EntryActions
        entry={entry}
        path={path}
        menuOpen={menuOpen}
        download={download}
        onMenu={onMenu}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

/** The vertical span of a box, which is all the placement rule reads from one. */
function spanOf(element: Element): Span {
  const box = element.getBoundingClientRect();
  return { top: box.top, bottom: box.bottom };
}

/**
 * The span that would clip the menu: its row's nearest scrolling ancestor — the
 * tree column's `overflow-y-auto` scroller, past whose edge a menu is not drawn
 * but cut off. `overflow: hidden` counts, because it clips just as hard.
 *
 * With no scroller above the row, the page answers. Every rendered test has no
 * scroller — jsdom applies none of these classes — which leaves the placement on
 * its downward default there, and the browser check to say where the boxes are.
 */
function clipOf(row: HTMLElement): Span {
  for (let node = row.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') return spanOf(node);
  }
  return spanOf(document.documentElement);
}

/**
 * A row's `⋯` and the menu it opens — the same two entries on a tree row and a
 * flat row, so both say the same thing about an entry.
 *
 * Which edge the menu hangs from is measured rather than assumed (ticket 55):
 * the drawer is a 42vh strip with its own scroller, and a menu that opens below
 * the drawer's last row is cut off by that scroller rather than overlapped.
 */
function EntryActions({
  entry,
  path,
  menuOpen,
  download,
  onMenu,
  onRename,
  onDelete,
}: {
  entry: FileEntry;
  path: string;
  menuOpen: boolean;
  download: DownloadControl;
  onMenu: (path: string | null) => void;
  onRename: (path: string, initial: string) => void;
  onDelete: (entry: Confirm) => void;
}): ReactElement {
  const [placement, setPlacement] = useState<MenuPlacement>('below');
  const menuPanel = useRef<HTMLDivElement | null>(null);

  /**
   * The flip, from the boxes rather than from a rule about which rows count as
   * low: the row's span, the span of the scroller that would clip the menu, and
   * the menu's own height. It runs with the menu already in the DOM and before
   * the browser paints, so the last row never shows itself clipped even for a
   * frame. The row stays the menu's containing block either way, which is what
   * `top-full` / `bottom-full` are measured against.
   *
   * A scroll re-measures, in the capture phase so the drawer's own scroller is
   * heard without hunting for the element that owns it. The row and the scroller
   * do travel together, but the room is the scroller's edge *against the row*,
   * and that narrows as the row scrolls toward it: a menu opened with room below
   * would be cut off by its own scroller once the tree moved under it — the
   * failure this ticket exists to remove, arriving by a second route.
   */
  useLayoutEffect(() => {
    const panel = menuPanel.current;
    if (panel === null) return;
    const row = panel.parentElement;
    if (row === null) return;

    const place = (): void => {
      const menuHeight = panel.getBoundingClientRect().height;
      setPlacement(menuPlacement(spanOf(row), clipOf(row), menuHeight, MENU_GAP));
    };
    place();

    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('scroll', place, true);
    };
  }, [menuOpen]);

  /** The edge it hangs from, with the same 4px clearance at the row either way. */
  const hang = placement === 'below' ? 'top-full mt-1' : 'bottom-full mb-1';

  return (
    <>
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
            ref={menuPanel}
            role="menu"
            className={`absolute ${hang} right-0 z-20 flex w-32 flex-col rounded border border-line bg-panel py-1 shadow-lg`}
          >
            {/* A file's own bytes or a folder's zip (ticket 78) — the same
                anchor the code head uses. An escaping symlink has nothing to
                download, so it keeps Rename and Delete alone. */}
            {entry.type !== 'symlink' && (
              <DownloadAnchor
                download={download}
                path={path}
                directory={entry.type === 'directory'}
                role="menuitem"
                className="px-3 py-1 text-left text-[11px] text-ink hover:bg-white/5"
                onActivated={() => { onMenu(null); }}
              />
            )}
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
    </>
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
  view,
  isExpanded,
  onClick,
}: {
  entry: FileEntry;
  /** Which listing is drawing this row: the tree's folder opens, the list's enters. */
  view: View;
  isExpanded: boolean;
  onClick: () => void;
}): ReactElement {
  switch (entry.type) {
    case 'directory':
      return (
        <RowButton
          onClick={onClick}
          title={view === 'list' ? `Open folder ${entry.name}` : isExpanded ? 'Collapse folder' : 'Expand folder'}
        >
          {view === 'tree' && <span className="text-ink-dim">{isExpanded ? '▾ ' : '▸ '}</span>}
          <Name>{entry.name}</Name>/
        </RowButton>
      );
    case 'file':
      return (
        <RowButton onClick={onClick} title={`Preview ${entry.name}`}>
          <Name>{entry.name}</Name>
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
          <Name>{entry.name}</Name>
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
 * The code column's head: which selection this column is showing, and what can
 * be done with it. The open file wins; when nothing is open, the folder the user
 * last picked (expanded in the tree, entered in the flat list) is the selection
 * — so a folder has a Download anchor here too, not only in its row menu. The
 * root is never a selection: it has no name to save and is never downloadable.
 * `no file selected` remains the empty column's own label, because the panel has
 * no other empty state, so the head never disappears.
 *
 * Download sits outside the per-kind switch below because it answers a different
 * question: not "what can be done to these bytes" but "is there an entry here at
 * all". Any selected entry can be downloaded — including a file whose read
 * failed (its bytes never depended on the read) — and a folder downloads as a
 * zip. The only condition is that something is selected.
 */
function CodeHead({
  active,
  download,
  preview,
  actions,
  previewingMarkdown,
  onToggleMarkdown,
}: {
  active: string;
  download: DownloadControl;
  preview: PreviewState;
  actions: FileViewerActions;
  previewingMarkdown: boolean;
  onToggleMarkdown: () => void;
}): ReactElement {
  // `selectedFolder === null` means the selection, if there is one, is a file.
  const open = previewPath(preview);
  const selectedFolder = open === null && active !== '' ? active : null;
  const selection = open ?? selectedFolder;

  return (
    <header className="flex items-center gap-2 border-b border-line px-3 py-1">
      {selection === null ? (
        <span className="truncate font-mono text-[11px] text-ink-dim">no file selected</span>
      ) : (
        <span className="truncate font-mono text-[11px] text-ink" title={selection}>
          {selectedFolder === null ? selection : `${selectedFolder}/`}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {selection !== null && (
          <DownloadAnchor
            download={download}
            path={selection}
            directory={selectedFolder !== null}
            className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5"
          />
        )}
        <CodeActions
          preview={preview}
          actions={actions}
          previewingMarkdown={previewingMarkdown}
          onToggleMarkdown={onToggleMarkdown}
        />
      </span>
    </header>
  );
}

/**
 * The download control, shared by the code head and every row menu (ticket 78).
 * It is a real anchor to the route — not a `fetch` and a `Blob` — because the
 * bytes have to come from the disk: the viewer's text is the server's truncated
 * window (and a binary file has no text at all), so building the file out of what
 * is on screen would save a damaged one. `download` names it as the head and the
 * server's disposition do; a folder is named `<name>.zip` to match.
 *
 * What it says afterwards is the honest half this side can see: the message
 * fires on the click, because a browser tells the page nothing about a download
 * finishing — `downloaded x` means it was handed over, not that the save landed.
 */
function DownloadAnchor({
  download,
  path,
  directory,
  className,
  role,
  onActivated,
}: {
  download: DownloadControl;
  path: string;
  directory: boolean;
  className: string;
  role?: 'menuitem';
  onActivated?: () => void;
}): ReactElement {
  const name = downloadName(path, directory);

  return (
    <a
      href={downloadUrl(download.projectId, path)}
      download={name}
      role={role}
      onClick={() => {
        download.onDownloaded(name);
        onActivated?.();
      }}
      className={className}
    >
      Download
    </a>
  );
}

/** The name a download saves under: the entry's own, plus `.zip` for a folder. */
function downloadName(path: string, directory: boolean): string {
  return directory ? `${baseName(path)}.zip` : baseName(path);
}

/** The open file's controls — the right-hand half of the code head. */
function CodeActions({
  preview,
  actions,
  previewingMarkdown,
  onToggleMarkdown,
}: {
  preview: PreviewState;
  actions: FileViewerActions;
  previewingMarkdown: boolean;
  onToggleMarkdown: () => void;
}): ReactElement | null {
  switch (preview.kind) {
    case 'none':
    case 'loading':
    case 'binary':
      return null;
    case 'text':
      return (
        <>
          {/* Truncation is a caveat about the bytes, not the write state — so it
              takes its own inert element rather than the state's slot, and the
              chip keeps saying `read-only` beside it. */}
          {preview.truncated && <Note>truncated</Note>}
          {/* Markdown gets a second way to read the same bytes; every other
              file type has only the source, so it gets no such control. */}
          {isMarkdown(preview.name) && (
            <MarkdownToggle previewing={previewingMarkdown} onToggle={onToggleMarkdown} />
          )}
          {/* A truncated file holds only the 256 KiB prefix; editing it would
              clobber the rest, so the chip states the state without switching
              it, and its `title` says why. */}
          {preview.truncated ? (
            <WriteStateChip
              state="read-only"
              title="Only the first 256 KiB is here — saving would clobber the rest, so this file can't be edited."
            />
          ) : (
            <WriteStateChip state="read-only" title="Switch to writable" onClick={actions.edit} />
          )}
        </>
      );
    case 'editing':
      return (
        <>
          <WriteStateChip state="writable" />
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
  previewingMarkdown,
}: {
  preview: PreviewState;
  actions: FileViewerActions;
  previewingMarkdown: boolean;
}): ReactElement | null {
  switch (preview.kind) {
    case 'none':
      return null;
    case 'loading':
      return <Hint>Loading…</Hint>;
    case 'text':
      // A file's bytes are untrusted: they are React text nodes either way —
      // the line-by-line elements `CodeView` and `renderMarkdown` build, and the
      // gutter `CodeView` puts beside them. Nothing here sets markup.
      //
      // Preview is the rendered markdown, which has no line numbers to number:
      // the gutter and the colouring are source mode's, and only its.
      return previewingMarkdown ? (
        <div className="p-2">{renderMarkdown(preview.content)}</div>
      ) : (
        <CodeView content={preview.content} name={preview.name} />
      );
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

/**
 * The markdown mode switch: `Preview ⇄ Source`, named for the mode a click will
 * switch *to* (the prototype's `pvBtn`, `variant-a.js:132`). `aria-pressed` is
 * what carries the mode it is in — the label is the action, the state is the
 * button's.
 */
function MarkdownToggle({ previewing, onToggle }: { previewing: boolean; onToggle: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={previewing}
      title={previewing ? 'Show the markdown source' : 'Show the rendered markdown'}
      className="rounded border border-line px-2 py-0.5 text-[11px] text-ink hover:bg-white/5"
    >
      {previewing ? 'Source' : 'Preview'}
    </button>
  );
}

/**
 * The file's write state, as one chip: it names the state the file is **in**
 * (`read-only` ⇄ `writable`), carries the prototype's mark — a lock, a pencil
 * (`variant-a.js:98-103`) — and, when the state can be switched, *is* the switch.
 * The word is the state, not the action, and `aria-pressed` carries it for
 * assistive tech, so the control says what is true rather than what a click will
 * do. Because the word *is* the state, the switchable chip is always pressed:
 * carrying the write state there instead announced the opposite of the word
 * beside it — a control called `read-only`, unpressed, which reads as writable
 * (ticket 53's review). The tone is the level scale's: the resting chip is a
 * surface a step above
 * the head, the writable one the prototype's translucent accent (`styles.css:70-77`).
 *
 * Where there is nothing to switch the chip is a plain element, the same word
 * with no button: a truncated file, whose 256 KiB prefix cannot be saved over the
 * rest, and a file already being edited, where `Cancel`/`Save` are the write.
 */
function WriteStateChip({
  state,
  title,
  onClick,
}: {
  state: 'read-only' | 'writable';
  title?: string;
  onClick?: () => void;
}): ReactElement {
  const writable = state === 'writable';
  const surface = `inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
    writable ? 'bg-accent/15 text-accent' : 'bg-bg-3 text-ink-dim'
  }`;
  const body = (
    <>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        {writable ? (
          <>
            <path d="M4.5 19.5h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4.5 15.5z" />
            <path d="m13.5 6.5 3 3" />
          </>
        ) : (
          <>
            <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </>
        )}
      </svg>
      {state}
    </>
  );

  if (onClick === undefined) {
    return (
      <span className={surface} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={true}
      title={title}
      className={`${surface} hover:opacity-90`}
    >
      {body}
    </button>
  );
}

/** An inert micro-label — a caveat that is not a control. */
function Note({ children }: { children: ReactNode }): ReactElement {
  return <span className="text-[10px] tracking-wider uppercase text-ink-dim">{children}</span>;
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A toolbar action as an icon: the picture is decorative, so `label` is the
 * button's accessible name (and the tests' handle on it) while `title` carries
 * the context the visible text used to. The 32px square is narrower across than
 * the widest text button it replaced and half again as tall — those were 21px,
 * under any sane target size — so the target is the icon idiom the prototype's
 * `.icon-btn` and ticket 49's rail already use, and the height is the dimension
 * that improved. Five of them fit the 300px column on one line, where the labels
 * wrapped to two.
 */
function ToolbarButton({
  icon,
  label,
  title,
  onClick,
}: {
  icon: IconName;
  label: string;
  title: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded text-ink-dim hover:bg-white/5 hover:text-ink"
    >
      <Icon name={icon} />
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

/**
 * The move confirmation — the prototype's `Move "x" into "y"?`
 * (`common.js:625-628`), and the one dialog here that is not about destroying
 * something: a refusal it cannot make itself (a collision, a folder into its own
 * subtree) keeps the dialog open and says why, exactly as rename and delete do.
 */
function MoveDialog({
  request,
  error,
  onConfirm,
  onCancel,
}: {
  request: MoveRequest;
  error: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  return (
    <Overlay label="Confirm move">
      <h3 className="text-sm font-semibold text-ink">
        Move "{request.name}" into "{folderLabel(request.dest)}"?
      </h3>
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
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-canvas hover:opacity-90"
        >
          Move
        </button>
      </div>
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
