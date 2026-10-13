# 47: Creating a project from the sidebar

**What to build:** The build half of ticket 46's decision: the sidebar's `New project` affordance, the
`POST /api/projects` route behind it, and the one write at the projects root that route performs. Today
adding a project is `mkdir` on the server's disk and a refresh — which a user who only has the browser
cannot do at all.

**Blocked by:** 46

**Status:** resolved

- [x] `POST /api/projects` with `{ name }` creates one directory under the projects root and answers
      `201 { project }` — the same `Project` shape `GET /api/projects` lists, `id` = base64url of the
      canonical path.
- [x] The route is registered on the gated `/api` scope beside `GET /projects` (`app.ts` registers the
      two together; build call 1 below moved both into `server/src/projects.ts`), so it is authenticated
      by *where* it is registered — no new exemption, no new hook.
- [x] The write lives on the **discovery** seam (`createProject(name)` on `ProjectDiscovery`), not on
      `ScopedFs`. `discovery.ts` is the only module that reads the projects root, and `ScopedFs` is
      per-project and refuses its own root by design (`resolveWriteTarget('') → is_root`); project
      creation is the root-level sibling of both, and putting it anywhere else breaks that invariant.
- [x] A name that is not a single clean segment is `400` — empty, `.`/`..`, anything with `/`, `\` or NUL,
      longer than 255 bytes: the server's existing `name()` rule (`server/src/files/scoped-fs.ts:152`),
      re-used, not copied.
- [x] A **leading dot** is `400` as well, and that is *discovery's* rule rather than `name()`'s:
      discovery skips dot-directories, so a `.foo` project would be a directory the user could never see,
      while the drawer lists `.env` as an ordinary file. `name()` is not changed by this ticket.
- [x] An existing entry at the name is `409` — never overwritten, never followed, whatever its kind,
      a symlink included. (The drawer splits `symlink` out as `400` because there the danger is a write
      *through* a link; here nothing is written through anything, the entry is merely in the way, and a
      link that resolves inside the root is already a legitimate project.)
- [x] With no projects root configured the route is `503` with a readable message, never a silent
      success: `GET /api/projects` has the honest empty answer (`[]`), a create does not.
- [x] Creation is a **non-recursive `mkdir`** with the same never-overwrite posture as
      `ScopedFs.createDirectory` (`server/src/files/scoped-fs.ts:234`): an `lstat` pre-check plus `EEXIST`
      as the race loser.
- [x] After the `mkdir`, the new directory is canonicalized through the same allowlist `resolveProject`
      uses, and *that* path is what the id encodes — so a project made by this route and one found by a
      later rescan are the same row, with the same id.
- [x] The sidebar header grows a `New project` button beside Refresh. It opens a name dialog (title
      `New project`, confirm `Create`), and on a refusal the dialog stays open showing the server's
      message, exactly as the drawer's rename does.
- [x] On success: the dialog closes, the list reloads, the new project becomes the selected one
      (`aria-current`), and a `created <name>` toast says so. Selection is set by **id only** — `Workspace`
      derives `selected` from the refreshed list (`web/src/App.tsx:93-94`), so the id simply resolves when
      the reload lands; no second copy of the project is held.
- [x] The empty state stops being a dead end: *"No projects yet. Drop a folder into your projects root
      and refresh."* gains the button that now exists beside it.
- [x] **One dialog, not two.** The drawer's `NameDialog` (`web/src/files/FilePanel.tsx:1376`) and the
      `Overlay` it shares with the confirm/move dialogs (`:1517`) move into their own module and both
      callers use it; `FilePanel.test.tsx` stays green (its queries are by role and label, so the move
      should be invisible to it — if it is not, the extraction is wrong, not the test).

## Tests

- **server, against a real temp root** (`discovery.test.ts`'s style — real directories, no mocks):
  create → the name is in `listProjects` with its canonical path; a second create → `exists`; `../x`,
  `a/b`, `..`, `''`, a 256-byte name and `.hidden` → `invalid_name`; a file, a directory and a symlink
  already at the name → `exists`; no root → `no_root`.
- **server route** (`app.test.ts`'s style, the real handler): `201` and the `{ project }` shape, the
  `400`/`409`/`503` bodies, and `401` without a session.
- **web**: the button opens the dialog; submit posts; the list reloads and the new row is `aria-current`;
  a `409` keeps the dialog open with its message; confirm is disabled for a leading-dot name (the client
  mirror, `isValidName` in `web/src/files/reducer.ts:350`, plus discovery's dot rule).
- **No e2e spec, deliberately.** The browser suite exists for what jsdom cannot see — a download's chosen
  filename, drag geometry, resolved colours. A dialog, a fetch and a re-render are none of those, and the
  real filesystem effect is already covered against temp roots on the server side. Do not "restore" one.

## The calls made here — all reversible, and each named so it can be argued with

1. **A sidebar button, not the rail.** The prototype's rail carried an `add-project` icon; parity §P3
   called it a mock. Projects live in the sidebar and the refresh is already there, so the thing that adds
   one belongs beside it.
2. **A name and nothing else — no template, no initial content.** The directory is created empty, exactly
   as a server-side `mkdir` would. A README, a `git init`, a language preset: a different feature.
3. **The new project is auto-selected.** The user asked for it by name; landing in its chat is what they
   meant. It is also the cure for the "nothing happens" reading of the app — an empty chat with a
   composer is a worse answer than the project being open.
4. **No rename or delete of a project from the UI.** Removing a project row means destroying a directory
   on disk; decision 05's "keep-running + hide" is about the *scan*, not the UI. If it is ever wanted it
   is its own ticket with its own confirmation, not a free extra here.
5. **No registry, no metadata, no marker file** — the filesystem stays the single source of truth, which
   is the property that made the UI worth adding to.

**Landed as:**

```
server/src/discovery.ts       createProject(name) + CreateProjectResult on the discovery seam: `name()`
                              re-used for the segment, then discovery's own leading-dot rule, an
                              `lstat` pre-check, a non-recursive `mkdir` (EEXIST = the race loser), and
                              a canonicalization whose result is what the id, the path and the name all
                              come from
server/src/projects.ts        new: registerProjectRoutes — `GET /projects` moved here from `app.ts` and
                              the new `POST /projects` beside it, plus the CreateProjectResult →
                              201/400/409/503 mapping
server/src/app.ts             one line: the two routes are registered together on the gated scope
server/src/discovery.test.ts  real temp roots: the created row is the listed row, taken/overwritten
                              nothing, the nine bad names create nothing, and no root (unconfigured,
                              absent, or a plain file) is no_root
server/src/projects.test.ts   new: the route at the HTTP boundary — 201 `{ project }`, the 400/409/503
                              bodies, 401 without a session
web/src/dialogs.tsx           new: `NameDialog` + `Overlay`, extracted from FilePanel — the rule is now
                              a prop, because a project name is a drawer name *and* non-dot
web/src/files/FilePanel.tsx   the extraction's other half: imports both, passes `isValidName`
web/src/useProjects.ts        `create` on the hook, the POST behind it, and `isValidProjectName`
web/src/ProjectSwitcher.tsx   the header's `New project` button, the dialog, `created <name>` through
                              the app's toast, and the empty state's own button
web/src/App.tsx               `Shell` creates, selects the new id and reloads; `Workspace` passes the
                              create down — the new row is *found* by the reload, never held
web/src/App.projects.test.tsx new: the whole flow through the real shell, `fetch` stubbed — the POST's
                              body, the reloaded list and its `aria-current` row, the 409 that stays in
                              the dialog, the leading-dot refusal that never becomes a request
```

**Three calls made while building it** (the five above were the decision's; these are the build's):

1. **`GET /projects` moved into `server/src/projects.ts`** beside the new POST, so the two routes that
   own the projects root are one module registered by one line — the bullet's "beside `GET /projects`"
   read as a requirement about the *scope*, which `app.ts` still installs (`registerProjectRoutes` is
   called inside the gated `api.register`, and `projects.test.ts`'s 401 pins the result). The Reference
   row naming `app.ts:90` is the one thing this makes stale.
2. **`no_root` also covers a root that is not a directory**, not just an unconfigured one. `mkdir`
   reports the two differently by platform — `ENOENT` where the parent is missing, `ENOTDIR` where it is
   a plain file — and both are "nowhere to create" (503 with a message), which is the honest answer a
   create must give where a list can honestly say `[]`. A root we may not *write* to is left as the 500
   it is: that is a fault, not an empty answer.
3. **The created row's `name` comes off the canonical path** (`path.basename(canonical)`, exactly as
   `resolveProject` reads it) rather than off the request string, so a filesystem that stores the
   segment differently than it was asked for (a trailing dot, a case rewrite) cannot make the created
   row disagree with the row a later rescan — or an id — produces.

## Code review

Both axes on the branch (Standards: `AGENTS.md`, the repo's idiom and the smell baseline; Spec: this
ticket's checklist and its stated reasons). No hard violation on either axis; the Spec axis confirmed
all twelve checklist bullets and all four test bullets present, and no scope creep. Fixed in one pass:

1. **A `503` arm whose comment overclaimed.** `no_root`'s doc said "not a directory that can be written
   to" while only `ENOENT` was mapped — a root that is a plain file would have been a 500 on Linux
   (`ENOTDIR`). Both errnos now map to `no_root`, with a test that holds on either platform; `EACCES`
   is deliberately left a 500 and the comment now says so.
2. **The created row's `name` was the request string**, which can differ from what the filesystem
   stored. Now `path.basename(canonical)` — see call 3 above.
3. **A stray `export`** on the web side's `createProject` (used only inside its own module, unlike the
   `isValidProjectName` beside it) and the seam's parameter shadowing the imported `name()` — the import
   is now aliased so `createProject(name)` matches its own interface.

Declined on purpose:

- **The fourth copy of `failureMessage`, and `lstatOrNull`/`isErrno` again.** Each web transport and
  each server fs module already carries its own (`auth/transport.ts`, `files/transport.ts`,
  `useSessions.ts`; `allowlist.ts` has its own `realpathOrNull`). Extracting them is a refactor of
  modules this ticket does not touch, and the smell is the established pattern here, not new drift.
- **The client's 255-byte gap.** `isValidName` has no byte cap while the server's `name()` refuses over
  255 bytes, so the dialog enables a name the server then refuses — the same pre-existing gap the
  drawer's own create has had since ticket 20, and the server's message is what the dialog shows. A
  one-rule fix belongs to `isValidName`'s own ticket.
- **`useProjects` importing `isValidName` from the file drawer's reducer.** It is the bullet's own
  instruction ("re-used, not copied") and the alternative — a second copy of the segment rule — is the
  drift this repo keeps paying for.

## Reference

| What | Where |
|---|---|
| The seam this extends | `server/src/discovery.ts` (`ProjectDiscovery`, `resolveProject`) |
| The containment it re-uses | `server/src/allowlist.ts` (`canonicalizeInsideRoot`) |
| The name rule and the non-overwriting create it mirrors | `server/src/files/scoped-fs.ts:152` (`name`), `:234` (`createDirectory`) |
| Where `GET /projects` is registered | `server/src/projects.ts` (with the POST; `app.ts` registers both inside the gated scope) |
| The status mapping to follow | `server/src/files/transport.ts:356` (`writeOutcome`) |
| The button and the empty state | `web/src/ProjectSwitcher.tsx:27-37`, `:99-105` |
| The dialog being shared | `web/src/files/FilePanel.tsx:1376` (`NameDialog`), `:1517` (`Overlay`) |
| The client name rule | `web/src/files/reducer.ts:350` (`isValidName`) |
| Why selecting by id is enough | `web/src/App.tsx:93-94` (derived `selected`) |
