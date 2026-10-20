# 81: A session runs in the permission mode I pick — the decision, the four-mode contract, and the split

**What to build:** Nothing runnable. This is the decision ticket: record that **a session chooses the
permission mode it runs under**, fix the **four-mode contract** clodeck offers, settle the three places
where that contract is deliberately stricter than the SDK, and split the build into tickets. It is
ticket 58's and ticket 66's pattern — decisions in one place, first, so the build argues with none of
them.

**Blocked by:** none

**Status:** resolved — the user chose the four-mode contract on 2026-10-21, after a grilling session;
the docs moves below land in this ticket's branch; 82–84 follow from `/to-tickets`.

## The problem

In a browser there is no terminal for the SDK to ask in, and a remote chat is exactly where a silent
auto-approval is most expensive. clodeck already has the hard half of the approval path — `canUseTool`
bridged to a modal (tickets 08, 10) — but no way to *choose the policy*:

- `set_permission_mode` refuses unless a turn is already running (`server/src/ws/turn-manager.ts:202-208`,
  `no_active_turn`). A mode chosen before the first send has nowhere to go: `SendPromptPayload` carries
  only `{ prompt, profile }` (`shared/src/protocol.ts:113-125`).
- `web/src` has no mode control at all; the composer line holds only the provider picker
  (`web/src/chat/ChatPanel.tsx:244-289`).
- Each turn is a fresh `query()` (`server/src/ws/turn-manager.ts:160-172`), so even a mid-turn switch
  dies at the turn boundary and the next turn falls back to `'default'`
  (`server/src/sdk/anthropic.ts:108`).

The mode exists in the types (`shared/src/sdk.ts:25-32`), on the wire
(`shared/src/protocol.ts:152-154`), and in the SDK. It does not exist in the product.

## The four-mode contract

This table is the product's promise. It is not a paraphrase of the SDK — the next section says where
it deliberately disagrees.

| Mode (UI label) | wire value | Reads | Edit / Write | Bash |
|---|---|---|---|---|
| **Ask** | `default` | free | prompt | **prompt — every call, including read-only** |
| **Accept edits** | `acceptEdits` | free | free | **prompt — every call, including filesystem commands** |
| **Plan** | `plan` | free | **denied, no prompt** | **denied, no prompt** |
| **Bypass** | `bypassPermissions` | free | free | free |

"Free" means the call runs without asking; "prompt" means it parks in the approval modal; "denied"
means `canUseTool` answers deny without showing the user anything.

The first mode is named **Ask**, not "Default": the mode's name should say what it does, and
`default` is a position, not a behaviour. The wire keeps the SDK's values, so a future reader can still
match clodeck's choice to the SDK's union one-to-one. (The CLI's `manual` alias is the same mode under
a third name; clodeck does not use it.)

## Where the contract is stricter than the SDK (three deltas)

The SDK's own semantics are documented and are not these. Each delta is deliberate.

1. **Ask prompts on read-only Bash.** In `default`, "calls that don't require approval (file reads
   inside working dirs, read-only Bash commands, `Agent`) execute". clodeck's Ask sends every Bash
   call to the callback — `ls` and `git status` included. A command you did not see is a command you
   did not approve, and "read-only" is a claim about the command line, not a guarantee.
2. **Accept edits prompts on filesystem shell commands.** In `acceptEdits`, the SDK also auto-approves
   `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed` inside the working directory. clodeck's
   Accept edits approves only `Edit`/`Write`; every Bash call still asks. `rm`, in particular, is not
   an "edit".
3. **Plan denies instead of prompting.** The SDK routes file edits and shell writes to `canUseTool`
   in `plan` mode, so they *prompt*. clodeck's Plan answers deny without showing the modal: a plan is
   a plan, and nothing executes while it is being written. Leaving Plan is a mode change, not an
   approval.

**How each delta is enforced is a build decision, not this one.** The decision binds the behaviour.
The mechanism has two viable shapes — a per-run `PreToolUse` hook that forces the call to the
callback, or a per-run settings layer with `permissions.ask: ["Bash"]` — and the second cannot be
global: ask rules are evaluated *before* the mode, so a global one would also prompt in Bypass. The
first job of ticket 83 is to pick the mechanism and prove it against the real SDK.

## Project settings can tighten, never loosen

The SDK evaluates **hooks → deny rules → ask rules → mode → allow rules → `canUseTool`**. That order
makes a project's `.claude/settings.json` able to do two opposite things: an `allow` rule can
auto-approve a call the contract says must ask, and an `ask` rule can force a prompt inside Bypass.

The rule clodeck adopts:

- **Deny and ask rules from the project always apply.** They are the only mechanisms a project has to
  make itself safer, and no mode may silently defeat them.
- **Allow rules from the project do not loosen the four modes.** They are neutralised for the gating
  the contract describes. (clodeck's own `allowedTools: ['Read','Glob','Grep']` is not a project rule
  — it *is* the "reads free" column.)

The price is one honest sentence, which both the UI and the Bypass warning carry:

> A project's own deny/ask rules in `.claude/settings.json` will still apply.

## The settled decisions

| # | Decision | Why |
|---|---|---|
| 1 | clodeck offers **four** modes: Ask (`default`), Accept edits (`acceptEdits`), Plan (`plan`), Bypass (`bypassPermissions`). Labels are the contract's; wire values are the SDK's | the name should promise the behaviour; a mapping in one place beats a sixth vocabulary |
| 2 | **`auto` and `dontAsk` are refused at the wire validator** (`server/src/ws/client-message.ts:107-120`). The shared type stays a six-value mirror of the SDK | the wire should equal what the UI can send; `dontAsk` never calls `canUseTool`, so the modal would never appear and tools would be silently denied — indistinguishable from a hang |
| 3 | The unit is the **session (the run)**, not the project. The default comes from `CLODECK_PERMISSION_MODE` at boot (absent = `default`); a session may override it | the same shape as provider profiles (66); a project registry is a standing non-goal |
| 4 | The mode is held in `ProjectRun` **in memory** and passed to **every** `query()`. `SendPromptPayload` gains `permissionMode?` for the first send | each turn is a fresh `query()`; without this the mode silently reverts to `default` at the turn boundary |
| 5 | `set_permission_mode` keeps working mid-turn **and updates the stored mode**, so the next turn starts in it | the live switch and the session's memory must not disagree |
| 6 | **New chat** resets to the env default; **reconnect** restores the stored mode via the snapshot; a **project switch** keeps that project's run | the mode is session state, not a preference; it dies with the session |
| 7 | A mid-turn switch applies to **subsequent tool requests**; a parked approval is answered under the mode it was raised in | re-evaluating something the user is looking at would be unpredictable |
| 8 | The **contract is enforced by clodeck**, not inherited from the SDK: the three deltas above | the SDK's four names do not mean the four promises |
| 9 | **Project settings can tighten, never loosen** — deny and ask always apply; allow rules are neutralised | a mode must never silently defeat a project's own safety rule |
| 10 | **Bypass is gated four ways**: `allowDangerouslySkipPermissions: true` in the SDK options; `CLODECK_ALLOW_BYPASS` (default on, so a single-user server keeps the option); a project's `permissions.disableBypassPermissionsMode: 'disable'` wins; and the SDK's own root/sudo refusal is left to fail closed | the capability exists in every run because a mid-turn switch must be possible, so the gate must be explicit, not implicit |
| 11 | The picker sits **by the composer**, beside the provider picker, and is **not locked** after the first turn | thumb-reachable; unlike a provider, a mode is a filter for what comes next, not a transport fact that would poison the session |
| 12 | The **effective mode is always shown**; Bypass carries a **confirm on selection** and a **persistent badge** while active | a gate you cannot see is not a gate |
| 13 | The approval modal is unchanged: **Allow / Deny only** | "always allow", input editing and `AskUserQuestion` rendering are their own tickets |
| 14 | The mode never leaves the process: **no store, no file, no session metadata** | matches the effort's "no registry" rule and decision 66's "clodeck persists nothing" |

## What stays exactly as it was

- **The approval round-trip.** `canUseTool` → `approval_request` → modal → `approval_response`, with
  `snapshot.pendingApprovals` on reconnect (`turn-manager.ts:279-295`). No timeout is added: the
  callback stays pending indefinitely and a `null` return would block the tool forever, so the pending
  set must never be dropped.
- **One turn at a time per project**, and the run lifecycle (`turn-manager.ts:45`, `:99`).
- **`allowedTools: ['Read','Glob','Grep']`** as the only pre-approval (`anthropic.ts:106`). The SDK's
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning is expected here: those three tools are *meant* not to
  reach the callback.
- **The provider picker and its lock after the first turn** (`ProviderPicker.tsx:33-34, :86-99`). A
  provider is a transport fact; a permission mode is not.
- **The file layer, the allowlist, the auth gate, the origin check and the terminal.** Untouched.

## The docs that move (criteria)

- [x] `AGENTS.md` §"Standing decisions" — a **permission-mode bullet** stating the four-mode contract,
  the "project can tighten, never loosen" rule, and the bypass gates; the MVP scope line names the
  session's permission mode with provenance (decision 2026-10-21, ticket 81; built by 82–84).
- [x] `GLOSSARY.md` — **permission mode**, **Ask**, **Accept edits**, **Plan**, **Bypass**; the word
  "mode" alone is banned as a synonym for any of them.
- [x] `docs/adr/0003-permission-modes-are-a-contract-not-an-sdk-passthrough.md` — created: the four
  modes, the three deltas, the tighten-only rule, and the rejected alternatives (SDK passthrough, six
  modes, project-wins, per-project mode).
- [x] `.scratch/clodeck/spec-02-chat-transport.md:52` — the "concrete minimum" line that fixes
  `permissionMode: 'default'` and `allowedTools: ['Read','Glob','Grep']` as the policy carries a
  superseded pointer to this ticket; `:66` (`set_permission_mode` → `run.setPermissionMode`) gains the
  stored-mode sentence.
- [x] `.scratch/clodeck/handoff.md` §A — no longer "open — next"; points at this ticket and 82–84.
- [x] No code and no test: nothing here is executable. The pre-commit hook stays green because no
  package changed.

`/to-spec` collapses this ticket into `spec-09-permission-modes.md`; the README is deliberately **not**
in the list above (ticket 63's argument — a README describing an unbuilt flag is worse than a stale
one), and belongs to ticket 84.

## What landed

```
.scratch/clodeck/issues/81-permission-modes-decision.md   this record
docs/adr/0003-permission-modes-are-a-contract-…md         the contract, the three deltas, the rejected options
GLOSSARY.md                                               permission mode, Ask, Accept edits, Plan, Bypass
AGENTS.md                                                 a permission-mode bullet in §"Standing decisions";
                                                          the MVP line names the session's permission mode
.scratch/clodeck/spec-02-chat-transport.md                the "concrete minimum" policy is superseded
.scratch/clodeck/handoff.md                               §A closed, pointing at this ticket
```

Docs only — no code, no test.

## Ticket split (for `/to-tickets`)

**Vertical** slices, like 66's: each ticket is a complete path and is demoable on its own. Three
tickets, one chain, numbered 82–84 (not `81a`: `scripts/tickets.mjs`'s `FILE_NAME` reads only numeric
names, so a letter suffix falls out of the tracker silently).

- **(82) The composer picks the mode, and the run keeps it** — the chip beside the provider picker
  (Ask / Accept edits / Plan, not Bypass yet), `SendPromptPayload.permissionMode`, `ProjectRun`'s
  stored mode, `CLODECK_PERMISSION_MODE`, the snapshot, the New chat reset, and `set_permission_mode`
  updating the stored mode. The three modes run with the SDK's native semantics here; the contract
  deltas are 83. *Blockers: none.*
- **(83) The four modes are the contract, not the SDK's defaults** — the three deltas (every Bash
  prompts in Ask and Accept edits; Plan denies without prompting), the "project can tighten, never
  loosen" rule, and Bypass with its four gates and its confirm + badge. *Blockers: 82.*
- **(84) The operator's docs catch up** — README, including the Bypass warning sentence and the
  `CLODECK_PERMISSION_MODE` / `CLODECK_ALLOW_BYPASS` variables. *Blockers: 83.*

## Reference

- Claude Agent SDK permissions — `https://code.claude.com/docs/en/agent-sdk/permissions`,
  `…/agent-sdk/typescript`, `…/permission-modes`, `…/settings-reference`.
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `PermissionMode` (six values),
  `CanUseTool`, `PermissionResult`, `Options.permissionMode`, `allowDangerouslySkipPermissions`.
- Tickets **07** (provider seam), **08** (bus + approvals), **10** (approval modal), **66** (the
  session-chosen pattern this ticket follows).
- `server/src/ws/turn-manager.ts:160-172, :202-208, :237-276, :279-295` — the send, the live switch,
  the New chat reset, the snapshot.
- `server/src/sdk/anthropic.ts:100-123, :281-297` — the options, and the `canUseTool` bridge.
- `shared/src/protocol.ts:113-125, :152-154`; `server/src/ws/client-message.ts:107-120` — the payloads
  and the validator that narrows to four.
