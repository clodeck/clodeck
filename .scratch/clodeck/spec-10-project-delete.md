# Clodeck — deleting a project (a real delete, and the safety that pays for it)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Yek project ke eshtebāhi sakhte shode — yek daf'e `New project` zade va esm-e dighari tāyp karde — yā yeki
ke kāresh tamām shode, emrooz faghat az tarigh-e **shell** az clodeck hāzef mishavad. Sidebar faghat do
kār balad ast: list kardan va sākhtan. In daghighan hamān chizist ke mahsool barāyash sākhte shode ke
lāzem nabāshad: login kon, az har jā bā browser kār kon, bedoone shell.

Va mas'ale faghat "row-e ezāfe" nist: har jā ke yek project directory ashghāl-e kāri dāshte bāshad (build
output, venv, node_modules), ān disk barāye hamishe por mimānad. Kārbār-e remote ke be server dastresi-e
shell nadārad aslan nemitavānad tamiz kone.

Risk-e in feature ham rowshan ast: delete yani **recursive removal-e yek directory** ke undo nadārad. Har
tarhi bāyad in kār-e irreversiblerā dar yek sidebar bārik, kenār-e row-hāy-e digar, amn konad — va
hazine-yash rā az jāyi bedahad ke faghat vaghti lāzem ast pardākhteh mishavad.

## Solution

Yek `Delete…` dar row menu-e har project. Kārbār esm-e project rā **tāyp** mikonad va dialog masir-e
canonical rā neshan midahad; ba'd server directory rā **vāghean** va recursive hazf mikonad — bedoone
trash va bedoone registry. Age run-i zende bāshad yā terminal-i attached bāshad, javāb `409` ast, na kill;
kārbār avval stop mikonad, ba'd delete. Transcript-hāye SDK ke SDK zir-e `~/.claude/projects` negah
midārad **dast nakhorde mimānanad**, pas delete faghat yek jā—dākhel-e allowlist—chi zi rā az beyn mibarad.

## User Stories

1. As the user, I want to delete a project I created by mistake, so that the sidebar reflects what I
   actually work on.
2. As the user, I want to delete a project whose work is finished, so that the server's disk does not
   fill with dead checkouts.
3. As the user, I want the delete to remove the directory for real, so that "deleted" means what it says
   and no hidden copy is left on disk.
4. As the user, I want to be asked to type the project's name, so that one misclick on a narrow row
   cannot destroy a working tree.
5. As the user, I want to see the exact path that will be removed, so that I know which directory leaves
   the disk before I commit.
6. As the user, I want the delete refused while a turn is running, so that the assistant is never writing
   into a directory that disappears under it.
7. As the user, I want the delete refused while a terminal is open, so that a shell is never left
   attached to a path that no longer exists.
8. As the user, I want the refusal to name what is in the way, so that I know whether to stop the turn or
   close the terminal.
9. As the user, I want to stop the turn and then delete as two separate acts, so that neither happens by
   surprise.
10. As the user, I want a project reached through a symlink to be refused, so that a delete never removes
    a directory whose name I did not choose.
11. As the user, I want the list to refresh after a delete, so that the row is gone without a manual
    refresh.
12. As the user, I want a confirmation toast, so that I can tell a successful delete from a silent no-op.
13. As the user, I want my selection cleared when I delete the project I was looking at, so that the chat
    stage is not left pointing at nothing.
14. As the user, I want to land on the empty state rather than be jumped to another project, so that the
    app does not choose a replacement for me.
15. As the user, I want a server error to stay inside the dialog, so that I can retry without re-typing
    the name.
16. As the user, I want to cancel at any point, so that opening the dialog is never itself a commitment.
17. As the user, I want the delete behind the same login as everything else, so that a remote deployment
    has no unauthenticated destructive route.
18. As the user on a phone, I want the row menu to be a deliberate tap rather than a side effect of
    selecting a row, so that touching a project does not start a destructive flow.
19. As the user, I want the delete to be a hard delete with no trash, so that I do not have to manage a
    second kind of storage and a second lifecycle.
20. As the user, I want to know that session history survives a project delete, so that re-creating the
    project can still show its old conversations.
21. As the user, I want a re-created project to start a fresh conversation, so that it cannot silently
    continue a conversation from a directory that had been deleted.
22. As the user, I want Resume to stay an explicit button, so that returning to old history is always my
    choice.
23. As the operator, I want the delete to stay inside the projects root, so that no request can ever
    destroy something outside the allowlist.
24. As the operator, I want the SDK transcripts left alone, so that clodeck has exactly one place where
    it destroys data, and it is inside the allowlist.
25. As the operator, I want orphaned transcripts documented, so that I know where a deleted project's
    disk usage still lives.
26. As an agent building this, I want few and stable refusal codes, so that the client can map each to a
    sentence and the tests can pin them.
27. As an agent building this, I want the delete to live on the discovery seam, so that no other module
    learns to touch the projects root.
28. As an agent building this, I want the busy check to read the run's own state, so that a run which has
    started but not yet named a session cannot be deleted under.

## Implementation Decisions

### Vocabulary

- **Delete a project**: remove the project's directory from the projects root, recursively, with no copy
  kept. Not "hide", not "trash", not "unlink".
- **Live run**: a `ProjectRun` whose `active` is set / whose status is not idle — *not* merely a run that
  exists or that has a session id.
- **Attached terminal**: a pty the terminal manager currently holds for that project.
- **Ambiguous id**: a project id that more than one root entry canonicalizes to, or whose only entry is a
  symlink.

### The discovery seam gains `deleteProject`

`ProjectDiscovery` — the only module allowed to touch the projects root — gains one operation,
`deleteProject(id)`, returning its own small union: removed, not found, or refused as a symlink/ambiguous
entry. It lives beside `createProject` for the same reason that one does: it is a **root-level**
operation, and `ScopedFs` refuses its own root by design. The existing project-scoped remove is not
reused — it is scoped to a project's contents, would happily unlink a symlink, and knows nothing about
the root.

The root itself needs no arm of its own: it is not an immediate child of itself, so the id of the root
never resolves to a deletable project.

### The route and its codes

`DELETE /api/projects/:id`, registered with the other two project routes and authenticated by *where* it
sits — the gated `/api` scope — the same way create is. No body.

| Outcome | Status | Body |
|---|---|---|
| removed | `204` | none |
| id does not resolve through the allowlist | `404` | `{ error: 'not found' }` |
| a run is live | `409` | `{ error: 'turn_in_progress' }` |
| a terminal is attached | `409` | `{ error: 'terminal_attached' }` |
| a symlink entry, or an ambiguous id | `400` | `{ error: 'symlink' }` |

`turn_in_progress` is the code the session-delete route already uses, so one word means one thing across
the API.

### The busy check runs before the seam, and reads the run's state

The route asks two questions of the runtime, then the seam: is a run live, is a terminal attached, and
only then `deleteProject`. The run question is deliberately **not** the existing "which session is
running" helper: that answers `undefined` for a run that has started but has not yet been given a session
id, which would let a delete land underneath it. The check is the run's own lifecycle state, the one the
turn pipeline clears in its `finally`. The terminal question is the terminal manager's own "is one
attached" probe.

Stop-then-delete was rejected: closing a terminal under the user leaves the socket that owned it holding
a dead pty, and a delete that also stops things makes one click mean two acts.

### The symlink rule

A project is deletable only when **exactly one** entry under the root canonicalizes to the requested id
**and** that entry is a real directory (`lstat`, not a symlink). Anything else is `400 symlink`.

The rule exists because discovery lists symlinks and deduplicates by canonical path: a link `alpha` →
`zulu` can be the row the user sees for `zulu`'s id. Deleting by id would then destroy `zulu` while the
label said `alpha`; unlinking the link instead would leave every file in place and make "deleted" a lie.

### The run is forgotten on delete

The turn manager keys its per-project run by the project id, and keeps that entry after a turn ends. The
id **is** the canonical path, so deleting `foo` and creating `foo` again yields the same id and would find
the same stale entry — whose session id the next send auto-resumes. The delete therefore drops the run
entry, so a re-created project starts with no session id. This is not persistence: nothing new is stored,
one existing in-memory entry is removed.

### The web: row menu, typed dialog, after-delete

- The sidebar's row gains a hover `⋯` menu with one item, `Delete…`. Selection is unchanged; opening the
  menu is not selecting.
- The confirmation is the **typed project name**: exact and case-sensitive, confirmed only when it
  matches, with the canonical path shown, an explicit "this cannot be undone", and a cancel that is
  always available. It extends the existing name-dialog primitive, which already knows how to validate
  and disable its confirm button; comparing the typed value to the existing name is the new part.
- On a refusal the dialog stays open with the server's sentence — the pattern both existing delete
  dialogs follow.
- On success: reload the list, show a `deleted <name>` toast (symmetric with `created <name>`), and if
  the deleted project was selected, clear the selection to the existing no-project empty state rather
  than selecting a neighbour.

### What we do not do

No trash directory, no registry, no metadata file, no purge of the SDK transcripts, no rename, no undo,
no bulk delete. The session-delete route's "hard delete" is the precedent, and this feature follows it.

## Testing Decisions

- **What makes a good test:** external behaviour only — for the server, the HTTP status and body plus
  what is actually on the sandbox disk; for the web, what the DOM shows and what the surface asks the
  server to do. No test reaches into private helpers or asserts call order inside a module.
- **Route seam** (prior art: the existing projects route suite — real handler, installed gate, sandbox
  root, injected request): `204` and the directory is gone; `404` for an unresolvable id; `400` for a
  symlink entry; the root's own path is a `404`, and nothing outside the root is ever touched.
- **Discovery seam** (prior art: the discovery suite, real directories and symlinks): the delete union —
  removed, not found, symlink/ambiguous — decided by the scan rather than by the decode, and the seam
  never treats the root as a target.
- **Bus seam** (prior art: the session-delete suite's live-run test — a real run started through the
  socket against the fake provider that holds it): `409 turn_in_progress` for a run that has *not* named
  a session yet (the case the old helper misses), `409 terminal_attached` against the fake pty, and —
  after a delete followed by a re-create — a send that carries **no** resumed session id.
- **App shell** (prior art: the project flows suite): menu → dialog → typed name → delete → reload,
  toast, and selection cleared; a refusal keeps the dialog open with the message.
- **Row** (prior art: the switcher's row suite): the menu affordance exists on a row and calls the
  delete callback; it is not the row's selection handler.
- **Dialog primitive** (prior art: the dialogs suite): confirm disabled until the exact name is typed,
  case-sensitive, and enabled again when it matches.
- **No test talks to a real provider or a real shell** — the existing fake-provider and fake-pty rule
  holds unchanged.

## Out of Scope

- **Rename** — ticket 47 deferred it explicitly; this ticket does not pick it up.
- **Trash, undelete, retention, "empty trash"** — refused by the decision. If revisited, the shape that
  makes it cheap is a `.trash/` dot-directory under the root, which the project scan already skips.
- **Purging a deleted project's SDK transcripts** — a maintenance command at most, and it would reach
  outside the allowlist.
- **Deleting files or folders inside a project** — already exists in the file drawer; this feature
  deletes the project, not its contents.
- **Multi-user actor semantics** — the discovery seam was written to absorb an actor later; this slice
  has one user.
- **Stopping a run from the delete flow** — refused instead, deliberately.

## Further Notes

- The decision record is ticket 87, which carries the exact references and the rejected alternatives.
- **Residue by design:** after a delete, `~/.claude/projects/<sanitized path>/` still exists. A project
  re-created at the same path can therefore list the old sessions in History — allowed, and arguably the
  only undo this feature has. What the run-forgetting decision forbids is the *implicit* resume; the
  user presses Resume.
- **No ADR.** No new rule is minted: project operations live on the discovery seam, and the filesystem is
  the single source of truth, which is already recorded (tickets 46 and 79).
- This slice depends on nothing in spec-09 (permission modes), and nothing there depends on this.
