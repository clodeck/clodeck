# Clodeck — file viewer slice (scoped read + write, REST, tree/preview)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Ta inja chat ✓, history/resume ✓, terminal ✓ — amma chaharomin va akharin item-e MVP-e `AGENTS.md` (file viewer) hanooz ye `Stub`-e kholi dar `App.tsx`-e: `<Stub title="Files" note="The read-only file viewer lands in a later slice." />`. In slice un stub ro ba ye file drawer-e vaghe'i avaz mikonad, tebghe **decision 03**-e web-claude-ui: na faghat browse/preview-e read-only, balke **file ops** ham dar bar migirad — new file, new folder, rename, delete, upload — hame confirmed dar UI.

Riski-tarin bakhsh in ast ke in avvalin slice-i ast ke **path-e dakhel-e project** ro mikhanad va **minesiad** (na faghat rishe-ye project). Terminal va chat faghat ye `cwd`-e canonical migereftan; file drawer bayad brows va mutate kone, ke yani ye `..` ya ye symlink-e escape mitone be shekl-e **read** ya **write** be out-of-project reside — va chon hich auth-i ta wayfinder 07 nist, in farghe beyn-e ye drawer-e mahdud va ye file-RCE ast. Chalesh-e dovom: write-op-ha chiz-i ro neveshtan/bazneveshtan/rename/hazf mikonand, pas ye ghalat-e koochik be shekl-e data-loss-e project bar migardad. Hich kodum ba ye route-e `readFile(rawPath)`/`writeFile(rawPath)` hal nemishe — be ye **fence-e type** (baray-e compile) + ye **re-validation-e runtime** (baray-e wire) + **guards-e specific-e write** (no symlink-follow, no overwrite, no root-delete) niaz darad.

## Solution

Dastresi-e filesystem ro be ye module-e root-scoped-e joda (`ScopedFs`) tabdil mikonim ke **faghat** mitone path-hayi ra bekhanad/benevisad ke ghablan az hamoon seam-e allowlist (`realpath` + containment) rad shode-and. Fence-e type **do branded type** ast:

- **`ScopedPath`** — tanha rahe sakhtanesh `resolve()`-e; `listDir`/`readFile` faghat in ro migirand, pas fersestadan-e `string`-e khodkar be reader compile-error ast.
- **`FileName`** — tanha rahe sakhtanesh `name()`-e (ye segment-e yekta, bedune separator/`.`/`..`/NUL); write method-ha faghat in ro baray-e *name* migirand, pas ye path-e traverse dar jaye name compile-error ast.

Chon type-system runtime nadarad va wire untrusted ast, har operation dar runtime **dobare** az `realpath`-containment-e `allowlist.ts` rad mishe, va write-op-ha guards-e ezafi darand: **hich symlink-i dar segment-e akhar follow nemishe** (`flag:'wx'` + `lstat`), **hich overwrite-i nist** (create/upload `409`-e exist-dar), **hich root-delete/rename nist** (`is_root`). Endpoint-ha dar hamoon scope-e encapsulated-e `/api` qarar migirand; `:id` az `resolveProject` rad mishe (hamoon shekl-e `sessions.ts`). `protocol.ts` dast nakhoorde mimoonad: file viewer REST ast, na event-e `/ws`, pas shape-ha dar `shared/src/files.ts` miravand.

**No new injected seam.** Baraks-e SDK/node-pty, `fs` native nist — `ProjectDiscovery` ham alan ba `readdir`/`stat`-e vaghe'i test mishe. Pas `buildApp({ projects, provider, spawner })` **taghir nemikonad**; reader az path-e canonical-e project-i ke `resolveProject` bar migardanad sakhte mishe. In slice faghat ye module + route ezafe mikone.

## User Stories

1. As a developer, I want a directory listing for a project, so that I can browse its files from the browser.
2. As a developer, I want to read a single file's content, so that I can preview code and text without leaving the UI.
3. As a developer, I want a new empty file and a new folder created inside a chosen directory, so that I can scaffold without dropping to the terminal.
4. As a developer, I want to rename an existing file or folder, so that I can fix names in place.
5. As a developer, I want to delete an existing file or folder (with a confirm, and a folder-delete warning), so that I can clean up.
6. As a developer, I want to upload a file's bytes into a chosen directory, so that I can bring in an asset.
7. As a security-conscious operator, I want every read *and* write path re-validated against the project root by `realpath` containment (not string prefix), so that `..`, absolute paths, and escaping symlinks are refused even though there is no auth yet.
8. As a security-conscious operator, I want writes to never follow a symlink in the target's final segment and never overwrite an existing entry, so that an escape or an accidental clobber is impossible by construction.
9. As a security-conscious operator, I want the project root itself un-renamable and un-deletable, so that one bad `DELETE` cannot remove the project.
10. As a developer, I want "is this path inside the root?" and "is this a single clean segment?" to be *types*, not comments — branded `ScopedPath` and `FileName` — so that passing an unvalidated string is a compile error.
11. As a developer, I want entry, content, and write-outcome shapes as discriminated unions (`FileEntry`, `FileContent`, `WriteResult`), so that rendering and error-mapping are exhaustive `switch`es with no stringly `kind`.
12. As a developer, I want the reader to return result unions instead of throwing, so that "outside root", "not found", "exists", and "symlink" are data the route maps to status codes, never an unhandled exception.
13. As the user, I want directories listed before files, sorted by name, so that the tree reads naturally.
14. As the user, I want a symlink that stays inside the project to be followed, and one that escapes to be shown but not navigable, so that project-local links work without an escape hatch.
15. As the user, I want binary files shown as "binary · N bytes" and very large text files truncated with a clear indicator, so that a `.png` or a huge log cannot garble or stall the preview.
16. As a frontend developer, I want the drawer wired as a data seam shaped like `useChat`/`useTerminal`, so that tree state (path, expansion, listing, preview) and mutations are owned in one place and the panel is declarative.
17. As a frontend developer, I want file content rendered only as React text nodes (never `innerHTML`/`dangerouslySetInnerHTML`), so that a hostile file's bytes cannot execute code in the browser.

## Implementation Decisions

### The type fence — branded `ScopedPath` + `FileName` (no stringly paths, no stringly names)

- Do branded type dar `server` (semantic-ashun — realpath containment va single-segment — server-i ast):

```ts
// server/src/files/scoped-fs.ts
declare const scoped: unique symbol;
/** A path that has canonicalized inside the project root. The *only* way to make
 * one is `resolve`, so a read function that takes this cannot be handed an
 * arbitrary string — the compiler rejects it. The brand is compile-time only:
 * bytes that arrive over the wire are still re-validated at runtime. */
export type ScopedPath = string & { readonly [scoped]: 'inside-root' };

declare const filename: unique symbol;
/** A single clean path segment — no `/` or `\`, no `.`/`..`, no NUL, not empty,
 * length-capped. The *only* way to make one is `name()`, so a write function
 * that takes this cannot be handed a name that traverses. Compile-time only,
 * like `ScopedPath`. */
export type FileName = string & { readonly [filename]: 'single-segment' };

/** Validate a single segment. Returns null on anything that is not a plain name. */
export function name(input: string): FileName | null;
```

- `ScopedFs` interface:

```ts
export interface ScopedFs {
  // reads
  resolve(rel: string): Promise<ResolveResult>;
  listDir(dir: ScopedPath): Promise<FileEntry[]>;
  readFile(file: ScopedPath): Promise<FileContent>;
  // writes
  resolveWriteTarget(rel: string): Promise<WriteTargetResult>;
  createFile(target: WriteTarget, content: Buffer): Promise<WriteResult>;
  createDirectory(target: WriteTarget): Promise<WriteResult>;
  rename(target: WriteTarget, newName: FileName): Promise<WriteResult>;
  remove(target: WriteTarget): Promise<WriteResult>;
}
```

- **In la "make illegal states unrepresentable" ast:** `listDir`/`readFile` faghat `ScopedPath` migirand, va `createFile`/`rename`/`remove` faghat `WriteTarget` (ke khodesh `ScopedPath` + `FileName` darad). `readFile('../../etc/passwd')` va `createFile({ parent, name: '../x' })` hargiz compile nemishavand. Route **majbore** avval `resolve`/`resolveWriteTarget` kone va tanha dar `status:'ok'` reader ro seda bezane.

- **`resolve`/`resolveWriteTarget` runtime-sandbox nistand, boundary-and.** Chon type-system dar `tsc` tamoom mishe va client raw string miferestad, har do dar runtime be `realpath`-containment (hamoon `canonicalizeInsideRoot`-e `allowlist.ts`) tekie mikonand. `resolve` target ro realpath karde, containment check mikonad, va `stat` mizane (kind). `resolveWriteTarget` **dirname** ro realpath karde (parent bayad directory-e mojood-e inside-root bashe) va **basename** ro az `name()` rad mikone — pas `parent` hich symlink-i nadarad (kamelan resolved ast) va `name` ye segment-e yekta ast. Tanha symlink-e momken, segment-e akhar-e target-e, ke write-op-ha ba `lstat` check mikonand (zir).

### The reader — read half (`server/src/files/scoped-fs.ts`)

- `createScopedFs(projectPath: string): ScopedFs` — `projectPath` **hamishe** path-e canonical-i ast ke `resolveProject` bar gardande. Reader hich noghte-ye digari be `fs` nemikhonad; in module tanha filesystem-door-e in slice ast (read va write).
- **`resolve(rel)`**: `rel` az `relPath`-e transport (syntax) rad shode; join → `realpath` → containment → `stat` → `{ status:'ok', scoped, kind: 'file'|'directory' }`. Har failure ye arm-e union ast, na throw:

```ts
export type ResolveResult =
  | { status: 'ok'; scoped: ScopedPath; kind: 'file' | 'directory' }
  | { status: 'not_found' }
  | { status: 'outside_root' };
```

- **`listDir(dir)`**: `readdir(dir, { withFileTypes: true })`; har entry → `FileEntry`:
  - `file` → `{ type:'file', name, size, mtime }`
  - `directory` → `{ type:'directory', name }`
  - symlink → `resolve`-e child; inside-root va dir/file → hamun kind; escape/broken → `{ type:'symlink', name }` (non-navigable). Sort: directory-ha ghabl, ba'd name asc (ruh-e `compareEntries`).
- **`readFile(file)`**: `stat` baray-e size; `read`-e avvalin `MAX_TEXT_BYTES` (256 KiB). Binary: NUL dar window ya `TextDecoder('utf-8', { fatal: true })` fail → `{ kind:'binary', size }`. Vagarna `{ kind:'text', content, truncated: size > MAX_TEXT_BYTES, size }`. Hich file-i kamel load nemishe.

### The writer — write half (same module)

- **`resolveWriteTarget(rel)`** (door-e write): `rel` empty → `is_root`; split `dirname`/`basename` → `resolve`-e dirname (bayad directory, inside root) → `name(basename)` → `{ status:'ok', target }`.

```ts
export interface WriteTarget { parent: ScopedPath; name: FileName; }
export type WriteTargetResult =
  | { status: 'ok'; target: WriteTarget }
  | { status: 'is_root' }         // empty rel — the project root itself
  | { status: 'not_found' }       // parent missing
  | { status: 'outside_root' }    // parent escapes
  | { status: 'not_a_directory' } // parent is a file
  | { status: 'invalid_name' };   // basename not a single clean segment
```

- **Write ops** — `WriteResult` union, mapped to status codes by the route:

```ts
export type WriteResult =
  | { status: 'ok' }
  | { status: 'exists' }    // create/upload onto an existing name
  | { status: 'not_found' } // rename/remove a missing name
  | { status: 'symlink' };  // create/upload through a symlink in the final segment
```

- **`createFile(target, content)`** / **`createDirectory(target)`**: `lstat(join(parent, name))` ghabl az create — symlink → `symlink`; mojood → `exists`; ENOENT → create. `createFile` ba `flag: 'wx'` (na `'w'`): `O_EXCL|O_CREAT` ham overwrite ro radd mikone ham follow-e symlink ro. `createDirectory` ba `mkdir`-e non-recursive (hamun do gard). Content-e upload `Buffer` ast; file-e empty `Buffer.alloc(0)`.
- **`rename(target, newName)`**: `lstat(join(parent, name))` ENOENT → `not_found`; vagarna `rename` be `join(parent, newName)`. `parent` realpath-shode ast (no symlink), va `rename(2)` destination ro atomic replace mikone **bedune** follow-e symlink dar segment-e akhar — safe. (Rename-e khod-e symlink-entry ham dar hamun dir mojaz ast; link ro rename mikone, na target.)
- **`remove(target)`**: `lstat` ENOENT → `not_found`; vagarna `rm(join(parent, name), { recursive: isDirectory, force: true })`. `rm` dar barabar-e symlink **khod-e link** ro hazf mikone, na target. Root az `resolveWriteTarget`-e `is_root` ghabl az inja rad mishe, pas `rm` hargez root nemibinad.
- **No overwrite, no follow, no root:** har write ye `lstat`-e pre-op + flag-e non-following darad. TOCTOU beyn-e `lstat` va syscall dar scale-e in slice (single-user, loopback, no auth) qabul-e — hamin posture-e terminal ast ("cwd convenience, na sandbox"); fence baray-e eshtebah-e accidental va escape-e obvious ast, na sandbox-e hardened.

### REST routes (dar scope-e `/api`, sibling-e sessions/terminal-size)

- `registerFileRoutes(api, { projects })` dar hamin plugin-e `/api`-e `buildApp` register mishe; `buildApp` signature **taghir nemikonad**. Addressing-e yeksan: har operation `?path=` migirad (relative; empty = root). Reads: `path` = directory ya file. Writes: `path` = target entry (parent+name az un derive mishe).
- **Reads**
  - `GET /api/projects/:id/files?path=<rel>` → `{ entries: FileEntry[] }`. `resolveProject` null → `404`; `relPath` syntax reject → `400`; `resolve` → `not_found`/`outside_root` → `404`; `kind:'file'` → `400` ("not a directory"); `directory` → `listDir` → `200`.
  - `GET /api/projects/:id/files/content?path=<rel>` → `{ content: FileContent }`. `kind:'directory'` → `400`; `file` → `readFile` → `200` (binary ham `200`, na error).
- **Writes**
  - `POST /api/projects/:id/files?path=<rel>` body `{ kind: 'file' | 'directory' }` → create (empty file / folder). `resolveWriteTarget` → map; `createFile(target, empty)` / `createDirectory(target)` → `WriteResult`. `ok` → `201`, `exists` → `409`, `symlink` → `400`.
  - `POST /api/projects/:id/files/rename?path=<rel>` body `{ to: string }` → `name(to)` null → `400`; `rename(target, newName)` → `200` / `404` (`not_found`).
  - `DELETE /api/projects/:id/files?path=<rel>` → `remove(target)` → `200` / `404`. (No body; confirmation client-side ast.)
  - `PUT /api/projects/:id/files/content?path=<rel>` raw body (octet-stream) → `createFile(target, body)` → `201` / `409` / `400`. Body cap `MAX_UPLOAD_BYTES = 200 MiB` (decision 03 default) via route `bodyLimit` → Fastify `413`. Upload = create, na overwrite (the deliberate overwrite is the save route's, `POST /files/save` — ticket **22**).
- **The two routes the promoted scope adds** — decision **D3** (2026-10-12) brought the rest of decision 03's file actions into MVP; these two need server routes, so they are named here for the inventory and pinned by their own tickets. Neither touches the `buildApp` seam or `protocol.ts`.
  - `GET /api/projects/:id/files/download?path=<rel>` — streams the file's raw bytes with an attachment disposition (`filename` escaped so a non-ASCII name survives). Guards are the read side's exactly: the same syntax check, the same `realpath` containment, an escaping symlink not served, a directory or the root refused. No truncation and no upload cap — a download is not an upload. Ticket **42**.
  - `POST /api/projects/:id/files/move?path=<rel>` body `{ to: <destination directory, relative> }` — cross-directory move; `rename` keeps its same-directory job. Both ends re-validated by containment, the destination an existing directory inside the root, no symlink in either final segment, neither end the project root, and no overwrite at the destination (the save route stays the one deliberate overwrite). Ticket **44**.
- **`relPath` (boundary-e syntax, ghabl az reader)**: hame-ye route-ha — read va write — `path` ro az in check rad mikonan: bayad relative bashad (na absolute, na drive-letter), hich segment-e `.`/`..`/empty/NUL nadare. Baray-e writes `resolveWriteTarget` + `name()` ham dobare check mikonan (chon `path` split mishe va basename az `name()` rad mishe), amma digar tanha check-e write nistand. In check gheyre-tekfar ast — qavi-tarin check containment-e `realpath` ast; syntax-check 400-e zoodtar mide.
- **Status-code discipline:** syntax/kind-e ghalat → `400`; unknown project / outside-root / not-found → `404` (leak nakon); exists → `409`; create → `201`; rename/delete → `200`. Error body = `{ error: string }` (ye envelope, mesl-e `sessions.ts`/`transport.ts`).

### Shared types (`shared/src/files.ts`, re-export az `index.ts`)

```ts
/** One entry in a directory listing — a discriminated union on `type`. */
export type FileEntry =
  | { type: 'file'; name: string; size: number; mtime: string }
  | { type: 'directory'; name: string }
  /** A link that escapes the root (or is broken): shown, never navigable. */
  | { type: 'symlink'; name: string };

/** One file's content — a discriminated union on `kind`. */
export type FileContent =
  | { kind: 'text'; content: string; truncated: boolean; size: number }
  | { kind: 'binary'; size: number };
```

- `mtime` ISO 8601; `size` byte count. Har arm daghighan field-haye khodesh ro darad (hich optional-field-e boodar). `WriteResult`/`ResolveResult`/`WriteTargetResult` **server-internal**-and (fs semantics); wire faghat `FileEntry`/`FileContent` + `{ error }` ast.
- **`protocol.ts` frozen mimoonad** (handoff): file viewer REST ast ba shape-haye joda, na taghir-e envelope — hamoon qa'ede-ye terminal.

### Web client

- Hich dependency-e jadid-e web lazem nist (tree/preview + prompt/confirm ba React + Tailwind-e mojood). Upload = `<input type="file">` (picker) + drag-drop roye drawer; `fetch` ba body-e raw.
- `FilePanel` be ja-ye `Stub title="Files"` dar `App.tsx` (hamoon cell; **keyed by project id**). Toolbar: New File, New Folder, Upload, Refresh. Har row ye ⋯ menu: Rename, Delete (confirm modal; folder-delete warning). Directory click = descend; file click = preview.
- `useFiles(project): { viewer: FileViewer; actions: FileViewerActions }` — seam-e data, be shekl-e `useChat`/`useTerminal`. State union-e discriminated (view) + ye record-e actions (mutations):

```ts
export type FileViewer =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; entries: FileEntry[]; preview: PreviewState }
  | { status: 'error'; path: string; message: string };

export type PreviewState =
  | { kind: 'none' }
  | { kind: 'loading'; name: string }
  | { kind: 'text'; name: string; content: string; truncated: boolean }
  | { kind: 'binary'; name: string; size: number };

export interface FileViewerActions {
  open(path: string): void;            // descend into a directory
  up(): void;                          // ascend one level
  refresh(): void;                     // re-list the current directory
  preview(path: string): void;         // read a file into the preview
  create(kind: 'file' | 'directory', name: string): Promise<void>;
  rename(path: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  upload(path: string, file: File): Promise<void>;
}
```

- `path` **relative** string ast ('' = root); na absolute path client negah midarad, na decode-e id. Har mutation dar akhar **re-list** mikone (refresh-e jari), va failure ro be surface-e error map mikone (409/413/400).
- **Renderer exhaustive:** `switch (entry.type)` va `switch (preview.kind)` ba `default: never`. File content faghat be shekl-e `<pre>{content}</pre>` (React text node) render mishe — **hich** `innerHTML`/`dangerouslySetInnerHTML` (bytes-e file untrusted ast). Symlink-e escape disabled (non-navigable). No pagination (lazy per-directory).

## Testing Decisions

- **What makes a good test:** assert external behavior — status code + body shape (route), union-arm + byte-window + guard (reader) — na private helper. `fs`-e **vaghe'i** dar barabar-e temp dir-haye vaghe'i (`createSandbox`-e `test-support.ts`), na mock-e `fs`.
- **The seams (instruction):**
  1. **`buildApp({ projects, provider, spawner })` — signature unchanged.** File route-ha dar hamin instance, hamin `/api` scope. Route-test ba `app.inject()`: `createSandbox` → `createProjectDiscovery(sandbox.root)` → `buildApp` (fake provider + fake spawner) → `inject`-e file endpoint-ha ba `:id`-e ye project-e listed.
  2. **`ScopedFs` reader+writer** — unit-tested bar rooye temp root: nested dir, file, symlink-inside (follow), symlink-outside (escape → `symlink` / write `symlink`), broken symlink, binary, truncation, create/rename/remove happy + `exists`/`not_found`/`is_root`/`invalid_name`, `..`/absolute/NUL. **No third seam**, no signature change.
- **Coverage that matters:** (a) `GET /files` root → `200` + dirs-before-files + sorted; (b) `GET /files?path=sub` → `200`; (c) `GET /files/content?path=f.txt` → `200` text; (d) binary → `200 { kind:'binary' }`; (e) big text → `truncated:true`; (f) `..`/absolute/NUL → `400`; (g) symlink escape → read `404` / listed `symlink`, va write → `symlink`; (h) `resolveProject` null → `404`; (i) `POST files` create file/folder → `201`; (j) create-e exist-dar → `409`; (k) `DELETE`/rename missing → `404`; (l) `DELETE`/rename-e root → `400`; (m) `PUT content` upload → `201` + bytes-on-disk, oversize → `413`; (n) no escape: write `..`/symlink hargez nemineasad out-of-root.
- **Symlink-creating test-ha POSIX-only** (`it.skipIf(win32)`; junction-e Windows ye symlink-e file nemitone besaze, pas un case-ha roye Windows nemiravand — in-ha tanha skip-ha-ye suite-and, hame symlink guard). Binary/truncation/create/rename/remove dar har platform test mishe (temp dir + Buffer).
- **Web verified by typecheck/build + exhaustiveness**, haman shekl-e terminal; ye pure-edge test baray-e renderer (exhaustive switch) acceptable ast, na lazem.
- **Non-goal:** no browser e2e, no live-fs mock, no fake reader injected dar `buildApp`.

## Out of Scope

In section ghablan panj file-action-e decision 03 ro aghab mindakht. Decision **D3** (2026-10-12) hame-ye
in panj ta ro be MVP bord, pas alan **in-scope**-and va inja faghat baraye sabt-e manba-e-haghighat
miyan, na baraye defer: **Move (drag-move)** → ticket **44**, **Download** → **42**, **Markdown
preview** ba `Preview ⇄ Source` toggle → **43**, **Tree⇄list toggle** → **41**, va **`size · modified`
metadata** roye file row-ha → **40**. **Content editing — editable toggle + save — ham dar MVP ast va
ship shode** (ticket **22**), pas khatt-e "ba'd az MVP"-e qabli digar inja nist.

Non-goal-hayi ke baghi mimoonan:

- **Permissions column** — server hich permission-i report nemikone va ye column-e permission baraye ye
  drawer-e remote-e single-user noise ast. Metadata-e promoted faghat `size` · `modified` ast.
- Auth (wayfinder 07) — in slice unauthenticated ast; route-ha zire `/api`-scope-and pas principal-aware hook-e ayande khodkar ghablashun miyafte. `HOST` loopback mimoonad.
- Git explorer, plugins, browser-use, model picker — out-of-MVP-e `AGENTS.md`.
- Pagination/lazy-deep-load baray-e dir-haye bozorg (MVP lazy per-directory); file watching (refresh dasti ast); configurable upload cap (constant-e `MAX_UPLOAD_BYTES` = 200 MiB, config ba'd).

## Further Notes

- In slice **faghat ye module + route** ezafe mikone — na dobare-tarhi, na `buildApp`-signature change, na seam-e jadid-e injected. `protocol.ts` frozen mimoonad; `files.ts`-e `shared` sibling-e `session.ts`-e.
- Ticket-ha az **`15`** edame mikonand (01–14 estefade shode). Split-e tabi'i (baraye `/to-tickets`): (15) shared file types (`files.ts` + re-export); (16) `ScopedFs` read half (branded `ScopedPath`, `resolve`/`listDir`/`readFile`, binary/truncation) + unit tests; (17) REST read routes (`GET /files`, `/files/content`) + inject() tests; (18) `ScopedFs` write half (branded `FileName`, `WriteTarget`, create/rename/remove, symlink/root guards) + unit tests; (19) REST write routes (`POST`, `rename`, `DELETE`, `PUT content`) + inject() tests; (20) web `useFiles` + `FilePanel` (toolbar + tree + preview + ⋯ menu + confirm), ja-y-e `Files` stub.
- `App.tsx`: `FilePanel` dar hamin cell-i neshast ke `TerminalPanel` ghablash bood (ja-y-e `Stub`-e Files), keyed by project, ta path/preview/expanded-e project-e ghabl be ba'd narenjad. **Be-rooz-e 2026-10-12 (ticket 32):** in do panel digar column-e sabet-e rast nistand — ticket **35** (Variant A) hardo be yek bottom drawer-e summonable mibare, pas in jomle digar ja-gozin-e layout nist.
- Symlink-resolution dar Windows elevation/junction mikhahad — test-e escape `skipIf(win32)`; reader dar production be `realpath`-e node tavakkol darad (junction ham resolve mishe), behavior consistent ast.
- Upload cap = `MAX_UPLOAD_BYTES` (200 MiB, decision 03 default) dar module-e route (`bodyLimit`). Env/config-e poro-khod ba'd.

## Code review

The slice was reviewed on the integration branch along two axes (Standards, Spec). Both reports are recorded here because the *declines* are design decisions a later session must not undo blind.

**Fixed (one pass, branch `review-fixes`):**

1. One `?path=` syntax check for reads *and* writes: `writeRelPath` is gone and the single `relPath` (renamed from `readRelPath`) fronts all six routes, so a write's bad path — `./x`, `a/../b`, `..`, absolute, NUL — is the same `400` a read gives it. This is the one observable status change: a traversal write was `404` (folded by the write door) and is now `400` (the syntax check fires first) — matching the read door and spec line 149.
2. The six-copy handler preamble collapsed into one `openProject(request, reply, options)` in `transport.ts`; every handler does `const opened = await openProject(...); if (opened === null) return reply;`. Envelopes and status codes are otherwise byte-identical. On `POST /files` and `POST /files/rename` the path check now precedes the body `kind`/`to` check — both were `400`s, so no observable change.
3. The missing NUL coverage: `transport.test.ts` pins a read route and a write route with a NUL in `?path=` → `400` (Fastify delivers `%00` to the route; it is not rejected earlier), and `scoped-fs.test.ts` pins the write door rejecting a NUL basename.
4. Three spec sentences corrected: the syntax check fronts every route (line 149), `useFiles` returns `{ viewer, actions }` (line 175), and the symlink-creating tests are the suite's only skips (line 212).

**Declined on purpose — do not "fix" these without new information:**

- **Renaming `name()` to something like `toFileName`.** The spec pins `name(input: string): FileName | null` verbatim (line 66); renaming it would break the pinned door for a cosmetic gain.
- **Sharing `realpathOrNull`/`isInsideRoot` with `allowlist.ts`.** The reader deliberately inlines the containment rule because it must distinguish `outside_root` from `not_found` while the allowlist folds both to `null`, and it deliberately holds no import from `allowlist.ts`; sharing a four-line `realpathOrNull` is not worth that coupling.
- **Sharing the `notFound` envelope with `sessions.ts`.** The terminal slice's review already declined this for the same reason: a per-module envelope, no cross-module coupling.
- **A failed preview read collapsing the viewer into its `error` arm and dropping the listing** (`web/src/files/useFiles.ts`). The pinned `PreviewState` union has no error arm and the spec pins all four arms, so the viewer's `error` arm is the only place a preview failure can be surfaced; Refresh/Retry recovers and the current path is preserved. A fifth arm would change a spec-pinned wire shape without the spec's say-so.
- **Dropping the client-side `sortEntries` re-sort.** The server already sorts, but user story 13 only pins "directories before files, sorted by name" and leaves a symlink's position unspecified, so the client's defensive re-sort (which groups symlinks with files) is not a contradiction — and the panel must not depend on the server's sort order.
- **`AGENTS.md`'s MVP bullet said "read-only file viewer"** while this slice adds confirmed create/rename/delete/upload. **Resolved by the user on 2026-10-11:** `AGENTS.md` now reads "file drawer (scoped read + write: new file, new folder, rename, delete, upload)", spells out the root-scoping posture, and keeps *content* editing (the editable toggle, save, markdown preview) out of MVP — so the two documents agree. **Superseded 2026-10-12 (ticket 32):** the editable toggle shipped (ticket 22) and decision D3 promoted markdown preview with the rest of that list into MVP, so the last clause is no longer true; both documents now carry those items.

The Spec axis found no scope creep, and the status codes match the spec route-by-route.
