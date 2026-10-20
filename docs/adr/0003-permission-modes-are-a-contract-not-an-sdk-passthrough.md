# A permission mode is a contract clodeck keeps, not an SDK constant it forwards

**Status:** accepted (2026-10-21). Establishes the four-mode contract recorded in
`.scratch/clodeck/issues/81-permission-modes-decision.md`. It narrows the "concrete minimum" policy of
ticket 07, which fixed `permissionMode: 'default'` and `allowedTools: ['Read','Glob','Grep']` as the
whole story (`spec-02-chat-transport.md:52`).

## Context

The Claude Agent SDK exposes **six** permission modes: `default`, `acceptEdits`, `bypassPermissions`,
`plan`, `dontAsk`, `auto`. clodeck runs each turn as a fresh `query()` on the user's own server, and
that server has no terminal for the SDK to ask in — the question can only reach the user through the
browser's approval modal, which clodeck already has (tickets 08, 10).

The SDK's evaluation order is: **hooks → deny rules → ask rules → mode → allow rules → `canUseTool`**.
That order is the source of the two facts this decision rests on:

1. A mode's name is not a complete promise. `default` runs read-only Bash commands without asking;
   `acceptEdits` also auto-approves `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed`; `plan`
   routes edits and shell writes to the callback, which is a *prompt*, not a denial.
2. A project's `.claude/settings.json` can act in both directions: an `allow` rule loosens what the
   mode would ask, and an `ask` rule forces a prompt even inside `bypassPermissions`.

A remote chat is where a silent auto-approval is most expensive: the user sees the transcript, not the
command line, and a command they never saw is a command they never approved.

## Decision

clodeck offers **four** modes, named for what they promise. The wire keeps the SDK's values; the
labels are the contract's.

| Mode | wire | Reads | Edit / Write | Bash |
|---|---|---|---|---|
| **Ask** | `default` | free | prompt | prompt — every call, including read-only |
| **Accept edits** | `acceptEdits` | free | free | prompt — every call, including filesystem commands |
| **Plan** | `plan` | free | denied, no prompt | denied, no prompt |
| **Bypass** | `bypassPermissions` | free | free | free |

**Three deltas from the SDK are the point of the ADR:** Ask and Accept edits force every Bash call to
the callback; Plan denies without prompting. The mode is a **per-session** choice (the run), held in
memory and passed to every `query()`.

**Project settings can tighten, never loosen.** Deny and ask rules always apply; allow rules are
neutralised for the four modes. The consequence is stated in the UI and in the Bypass warning: *"A
project's own deny/ask rules in `.claude/settings.json` will still apply."*

`auto` and `dontAsk` are refused at the wire validator. `auto` is a classifier clodeck does not show;
`dontAsk` never calls `canUseTool`, so its failures arrive as silent denials, indistinguishable from a
hang in a browser.

## Why the mode cannot simply be forwarded

Forwarding the SDK's value is one line and creates four lies in the UI. The user picks **Ask** and a
`rm` runs without a prompt because the mode calls it a "filesystem command"; the user picks **Plan**
and an approval modal appears, because the SDK's plan mode asks rather than refuses; the user picks
**Bypass** and is still interrupted by a rule they wrote months ago in a settings file. Each is a
promise the UI made and the runtime did not keep. The contract has to live in clodeck's own code,
next to the labels that state it.

## Consequences

- **The label and the wire value differ**, deliberately: the UI says *Ask*, the wire says `default`.
  One mapping, in one place; a future reader can still match clodeck's four to the SDK's union.
- **The verified mechanism is a `PreToolUse` hook** returning `permissionDecision: 'ask'` (probed
  2026-10-21 against SDK 0.3.296). It runs before rules and mode, and its decision is made in
  clodeck's closure, so it can be conditional on the mode. A per-run settings layer with
  `permissions.ask` also works but can only *add* rules — it cannot remove a project's ask rule — and
  a global one cannot be used because ask rules are evaluated before the mode and would also prompt
  in Bypass.
- **Plan has three SDK exceptions:** the SDK's own plan file under `~/.claude/plans/` is
  auto-approved; `AskUserQuestion` and `ExitPlanMode` reach the callback, so the plan denial must
  exempt the clarifying question and may answer `ExitPlanMode` with a denial that keeps the session
  in Plan.
- **The SDK's `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning is expected** for `Read`, `Glob` and `Grep`:
  they are pre-approved on purpose and never reach the callback.
- **Bypass is gated four ways** — the SDK flag, `CLODECK_ALLOW_BYPASS`, a project's
  `permissions.disableBypassPermissionsMode: 'disable'`, and the SDK's own root/sudo refusal. It is
  not a mode a project file can grant itself.
- **One documented exception remains:** a project's `ask` rule still prompts inside Bypass. That is
  the "tighten, never loosen" rule doing its job, and the warning says so.
- **The mode dies with the session.** A New chat starts at `CLODECK_PERMISSION_MODE`; a reconnect
  restores the run's stored mode; nothing is written to disk.

## Considered options

- **Forward the SDK's mode unchanged.** Rejected: the four names do not mean the four promises, and
  the deltas are exactly the calls a remote user cannot see.
- **Offer all six modes.** Rejected: `auto`'s classifier is not observable from clodeck's UI, and
  `dontAsk` turns every refusal into a silent denial. Both are honest in a terminal and misleading in
  a browser.
- **Let the project's settings win.** Rejected: an `allow` rule could auto-approve the very call the
  user selected Ask to see. Safety rules tighten; they do not loosen.
- **Per-project mode.** Rejected: it needs a registry, which this effort has repeatedly refused, and
  it makes the provider-profile pattern (a session chooses) inconsistent with itself.
