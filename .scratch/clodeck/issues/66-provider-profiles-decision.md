# 66: A session runs on a provider profile — the decision, the credential rule, and the split

**What to build:** Nothing runnable. This is the decision ticket: record that **a session chooses which
provider profile it runs on**, settle the credential rule that makes the choice safe, move the documents
that now contradict the product, and split the build into tickets. It is ticket 46's and ticket 58's
pattern — decisions in one place, first, so the build argues with none of them.

**Blocked by:** none

**Status:** ready-for-agent (decision taken by the user, 2026-10-15; tickets 67–71 are not yet files)

## The decision

One project, several sessions, each running on a different provider — a cheap model for grunt work and a
strong one for design, inside the same project, switched between. Today clodeck has exactly one provider,
constructed at boot (`server/src/main.ts` → `createAnthropicProvider()`, `server/src/sdk/anthropic.ts:42`)
and handed to `buildApp` as a single object. The unit of choice becomes the **session**.

The goal is **not** two live panes: run state is keyed by project (`server/src/ws/turn-manager.ts:45`,
one turn at a time per project at `:99`), and re-keying it to the session is a larger effort than this
feature. Comparison is **sequential switching** — run with one profile, switch, run with another.

## The two measurements the credential rule rests on

Both were taken against the real SDK, with the real provider's own options, and repeated. They are the
whole reason this ticket has an ADR.

1. **A project's `.claude/settings.json` `env` block overrides the server process's own `ANTHROPIC_*`.**
   With `settingSources: ['project']` (`anthropic.ts:85`) — which is also what loads `CLAUDE.md`, so it
   cannot be dropped — a project declaring `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
   `ANTHROPIC_MODEL` sent **all twelve** API calls of a turn to the endpoint named in that file, with
   that file's model and credential; the ambient environment's gateway received none. With
   `settingSources: []` every call went to the gateway and the file was ignored.
2. **The precedence is per key, and `Options.env` replaces.** With the file declaring only
   `ANTHROPIC_BASE_URL`, traffic went to the **file's** endpoint carrying the **run's** model and the
   **run's** credential. A run whose `ANTHROPIC_*` keys were deleted fell back to the CLI's own default
   model, not the ambient one — so `Options.env` must be built by spreading `process.env`.

Reproduction, for whoever wants to re-run rather than trust: a stub HTTP server on `127.0.0.1` logging
`{method, url, model, authKind, authLength}` and answering 500, plus a throwaway script calling
`query()` with `toSdkOptions`' exact options and printing the `system`/`init` message's `model`. One
variable changes between runs: `settingSources`. The verdict is which port receives the POSTs and which
model they carry.

**Per-key precedence is the crux:** one key in a project file is enough to cross a credential with an
endpoint it was not issued for, and nothing warns — the CLI prints nothing about precedence.

## The settled decisions

| # | Decision | Why |
|---|---|---|
| 1 | The unit of choice is the **session**, locked at its **first send** | cheap-vs-strong inside one project; a lock makes "sticky" a fact rather than a hope |
| 2 | **No simultaneous live sessions in one project.** One turn per project stays | `turn-manager.ts:45`,`:99`; re-keying run state is its own effort, and sequential switching already serves the goal |
| 3 | A **provider is an Anthropic-compatible endpoint**. clodeck grows no translation layer | DeepSeek works because it exposes `/anthropic`; Gemini & co. arrive through a proxy the operator runs |
| 4 | Profiles live in the **server's environment** (`CLODECK_PROVIDER_<NAME>_*`), read once at boot. The reserved **default** profile is the server's own environment | `config.ts`'s own principle: "the point of the password is not to be in [the config file]" |
| 5 | A profile is a **patch**, not a trio: any subset of {endpoint, credential, model}, the rest inherited. clodeck resolves a **complete** trio before sending | makes `deepseek-flash` and `deepseek-pro` one line each, and keeps the send rule applied to a resolution rather than to raw names |
| 6 | The project's `.claude/settings.json` is **accepted as the project's pin**, not fought | it is already a channel (measurement 1), and `settingSources: ['project']` is what loads `CLAUDE.md` |
| 7 | The **effective provider is always shown** | mandatory, not cosmetic: a choice against a pin otherwise does nothing, silently — the run's env reaches the CLI and is outranked key by key |
| 8 | **Endpoint and credential travel together; the model travels free** | ADR 0002. Declares endpoint *or* credential → clodeck sends only the model; declares neither → all three |
| 9 | One profile list, **classified by what it declares**: naming endpoint or credential = *provider*, naming only a model = *tier*. A pinned project offers **only tiers** | no second vocabulary, and a vendor's model name can never be sent to another vendor's endpoint |
| 10 | The binding is **client-side only**; clodeck still persists nothing. The UI says *"running on X now"*, never *"this session is X"* | Q1's stickiness and the absence of a store cannot both be true across a reload, so clodeck must not claim it |
| 11 | The picker **sits by the composer** | thumb-reachable, adjacent to where the prompt is typed |
| 12 | A credential in a project file is **readable by the model**; documented, not engineered around | measured: no dotfile filter (`scoped-fs.ts:174-182`, `:342-357`) and `Read` is auto-approved and project-scoped. Credentials that matter belong in server-env profiles |
| 13 | Assumptions, recorded rather than assumed: profiles are read **at boot** (changing them needs a restart, like the password hash); an **unknown or stale name is refused visibly**, never silently defaulted; a profile carries **transport facts only** — no permission mode, no tool list; the default is labelled *"server environment"*; an absent model means *the endpoint decides* | each would otherwise be a silent choice made by whoever writes the code |
| 14 | The client is told profile **names** and **models**, and whether the project pins — **never a credential**, and no endpoint it cannot already read for itself | the picker needs a list, not a secret. A pinned project's host may be shown, since the user can read that file in the drawer |

## What stays exactly as it was

- **`mirror.ts` and the mirrored message union.** One API shape, one narrowing function, unchanged.
- **One turn at a time per project** — the provider choice does not touch scheduling.
- **No registry, no store.** Profiles come from the environment; a session's binding is client state.
- **`buildApp({ projects, provider, spawner, auth, webRoot })`'s seams.** The provider stays the one
  injected seam, so the whole suite still runs against the fake — no test needs a credential or network.
- **The file layer, the allowlist, and auth.** Untouched, including the drawer's existing freedom to
  read and write dotfiles (decision 12 accepts it rather than changing it).

## The docs that move (criteria)

These are statements about what the product *is*, and the decision makes them false. The README's
provider block is deliberately **not** here: it describes behaviour, and a README describing an unbuilt
flag is worse than a stale one (ticket 63's argument). It belongs to ticket 71.

- [ ] `AGENTS.md` §"Standing decisions" — the MVP scope line names `model selection (UI model picker)`
      as **out of MVP**. It is now in, named the way the D3-promoted items are named, with its
      provenance (decision 2026-10-15, ticket 66; built by 67–70).
- [ ] `.scratch/web-claude-ui/map.md:38` — "model selection (UI model picker) — beyond the MVP
      destination; a later effort": a **superseded** pointer to this ticket. The map is closed and is not
      rewritten; what must not survive is a reader taking its line for current.
- [ ] `.scratch/clodeck/issues/07-sdk-provider-fake.md` and `.scratch/clodeck/spec-02-chat-transport.md`
      (Further Notes, "hich key-handling dar server nist") — the claim that the server never handles the
      API key narrows to *never stores, never persists, never invents one*: a superseded pointer to ADR
      `docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`.
- [ ] No code and no test: nothing here is executable. The pre-commit hook stays green because no package
      changed.

## Ticket split (for `/to-tickets`)

A **chain**, not a fan — each waits on the one before it.

- **(67) Profiles resolve from the environment** — read `CLODECK_PROVIDER_<NAME>_*` at boot; the reserved
  default; patch semantics with inheritance from the server environment; resolution to a complete trio;
  an unknown or stale name refused **visibly**. A pure function of the environment plus its tests.
  *Blockers: none.*
- **(68) A run carries a provider** — `SdkRunInput` (`server/src/sdk/provider.ts:30`) gains the resolved
  provider; `createAnthropicProvider()` stops being a boot-time singleton; `Options.env` is set as
  `{ ...process.env, ...trio }`, since it replaces. The boot-time instance becomes the **default
  profile**, so an operator who configures nothing sees no change. The profile list (names, models, which
  are tier-shaped) becomes readable by the client — names and models only (decision 14). *Blockers: 67.*
- **(69) The project's pin is honoured** — read `<project>/.claude/settings.json` through the existing
  scoped read; classify which of the three keys it declares; apply the endpoint-and-credential-together
  rule (decision 8); expose what a session in that project will actually run on. Security-critical: a
  test must pin that a project declaring **one** key never produces a mixed pair. *Blockers: 68.*
- **(70) The picker, by the composer, and the running-on line** — the profile/tier list where the prompt
  is typed, filtered to tiers in a pinned project, locked at the session's first send, with *"running on
  X now"* always visible. *Blockers: 69.*
- **(71) The operator's docs catch up** — the README's configuration table gains the `CLODECK_PROVIDER_*`
  block with the default stated; the proxy requirement is spelled out (a non-Anthropic vendor arrives
  through a translation proxy, and clodeck's renderer depends on that proxy emitting `stream_event`,
  `tool_use`, `can_use_tool` and `result` faithfully); the provider section points at ADR 0002. *Blockers:
  70.*

## Further notes

- **The ADR is `docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`**, and the vocabulary
  this ticket introduces — **provider**, **provider profile**, **tier**, **pinned project** — is in
  `GLOSSARY.md`. Use those words in the tickets; none of them is a synonym for another.
- **The mechanism is three keys in an environment; the work is the contract around them.** Setting
  `Options.env` is a handful of lines. Everything else — the resolver, the pin classification, the
  visibility, the refusal of a stale name — exists so that no configuration a user writes can send a
  credential to a host it was not issued for.
- **This is a phase boundary.** This ticket is the decisions and the split; `/to-spec` collapses it into
  `spec-08` (stories, implementation decisions, testing decisions, out-of-scope), and `/to-tickets`
  writes 67–71 as files. Building straight from this table would throw the linked detail away.
