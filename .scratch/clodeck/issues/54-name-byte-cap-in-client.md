# 54: The name rule refuses what the server refuses

**What to build:** The name dialogs enable `Create` and `Rename` for a name the server then refuses. The
client's rule rejects an empty, `.`, `..`, separator or NUL name but not one over the server's byte cap,
so the confirm button goes live, the request goes out, and a `400` comes back and has to be shown in the
dialog that should never have offered it. Make the client's rule the server's rule.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] A name the server would refuse for its length leaves the confirm button disabled instead of enabling
      a request that cannot succeed.
- [x] The limit is measured in **bytes**, as the server measures it, not in characters — a name in a
      multi-byte script gets fewer characters, and the client must agree with the server about which names
      those are. No second cap is invented; the server's is adopted.
- [x] **The refusal is not silent.** A name that has content and is refused says why, in the dialog, where
      the server's own refusal appears today. The composer's hint is this repo's precedent for saying a
      thing rather than letting a control go dead. An empty box stays as silent as it is today — there is
      nothing to explain yet.
- [x] One rule, both callers: the drawer's rule and the sidebar's (which is that rule plus the non-dot
      rule) both refuse it, so a file name and a project name agree. Neither caller gets its own copy of
      the cap.
- [x] The server is untouched: its cap, its message and its `400` are exactly as they are. The client is
      brought up to the server, never the reverse — the server is the one that can be trusted about the
      filesystem.
- [x] Tests: the rule is pure and unit-tested at the boundary (255 bytes accepted, 256 refused, a
      multi-byte name counted in bytes, the existing refusals still refused), and a rendered test drives a
      dialog to a disabled confirm for an over-long name.

**Landed as:** the client's rule answers with a *reason* rather than a boolean. `nameRefusal`
(`web/src/files/reducer.ts:367`) returns the sentence a refusal deserves, measuring with a `TextEncoder`
against the server's `MAX_NAME_BYTES` (255, `:351`), and `projectNameRefusal`
(`web/src/useProjects.ts:135`) composes it with the non-dot rule instead of restating it. `NameDialog` takes
a `refusal` prop (`web/src/dialogs.tsx:47`) in place of the old `isValid`, so the confirm button's state and
the message under it come from one call — `FilePanel.tsx:366` passes the drawer's rule,
`ProjectSwitcher.tsx:124` the project rule. The server is untouched.

## Reference

Server rule: `server/src/files/scoped-fs.ts:138-139` (`MAX_NAME_BYTES`) and `:152-155` (`name()`, with the
byte check). Client rule: `web/src/files/reducer.ts:367` (`nameRefusal`, the one rule, in bytes) and
`web/src/useProjects.ts:135` (`projectNameRefusal`, that rule plus the non-dot rule). The dialog that says
why: `web/src/dialogs.tsx:26-84` (`NameDialog`, whose `refusal` prop carries the reason to the confirm
button and to the line under the field). Source: the "Known loose ends" list in
`.scratch/clodeck/handoff.md`, where ticket 47's review declined to fix it in passing.
