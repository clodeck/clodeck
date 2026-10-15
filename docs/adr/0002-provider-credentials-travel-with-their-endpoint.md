# Provider credentials travel with their endpoint

**Status:** accepted (2026-10-15). Establishes the contract for
`.scratch/clodeck/issues/66-provider-profiles-decision.md`. The mechanism it constrains is
`server/src/sdk/anthropic.ts` — specifically `toSdkOptions`, which today sets no `env` key at all.

## Context

clodeck runs exactly one provider, chosen at boot: `server/src/main.ts` constructs
`createAnthropicProvider()` (`server/src/sdk/anthropic.ts:42`) and hands that single object to
`buildApp`. It never touches a credential — ticket 07's rule, written as *"the server never handles the
API key"*. `Options.env` is deliberately absent, on the documented ground that it **replaces** the
subprocess environment rather than merging into it, so the SDK reads the credential from the process
environment untouched.

Two measurements, both reproduced against the real SDK with the real provider's own options and
repeated for stability, changed what may safely be assumed:

1. **A project's `.claude/settings.json` `env` block overrides the server process's own `ANTHROPIC_*`.**
   `settingSources: ['project']` (`anthropic.ts:85`) also being what loads `CLAUDE.md`, it cannot be
   dropped. A project declaring `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_MODEL`
   sends every request of every session in it to that endpoint, with that model and that credential:
   pointing the project file at a local stub captured all twelve API calls, while the ambient
   environment's gateway received none. `settingSources: []` sent them all to the gateway instead. So
   a project directory is **already** a provider channel, with no code involved.
2. **The precedence is per key, and `Options.env` replaces.** With the project file declaring only
   `ANTHROPIC_BASE_URL`, traffic went to the *project's* endpoint carrying the *run's* model and the
   *run's* credential. A run whose `ANTHROPIC_*` keys were deleted fell back to the CLI's own default
   model rather than the ambient one — so `Options.env`, once set, replaces the environment wholesale
   and must be built by spreading `process.env`.

Per-key precedence is the crux. **A single key in a project file is enough to cross a credential with
an endpoint.** A project declaring only `ANTHROPIC_AUTH_TOKEN` receives whatever base URL wins; a
project declaring only a base URL hands that host whatever credential wins. That is a credential
delivered to a host it was never issued for, reachable by writing one line of JSON into a directory
clodeck is designed to let the user edit — and nothing warns, because the CLI prints nothing at all
about precedence.

## Decision

**An endpoint and its credential are one unit, and clodeck never supplies them from two different
sources. The model is a free axis.**

When clodeck sets `Options.env` for a run, it sends:

- **all three** keys from the resolved profile, when the project's `.claude/settings.json` declares
  **neither** the base URL nor the credential;
- **only the model**, when the project declares the base URL **or** the credential — both stay the
  project's;
- and never a base URL from one source beside a credential from the other.

A project that pins a provider therefore keeps it, visibly, and a session's choice degrades from *which
provider* to *which model* rather than silently losing or silently winning.

## Consequences

- **The server now reads a credential.** Ticket 07's "the server never handles the API key" narrows
  from *never touches* to *never stores, never persists, and never invents one*. It reads what the
  operator exported into its own environment and passes it into the subprocess. This is the price of a
  per-session choice, and it is paid deliberately rather than discovered later.
- **A session cannot override a project's pin, so the pin has to be visible.** Surfacing the effective
  provider stops being a nicety: without it, a choice made against a pinned project does nothing at
  all, with no error and no warning — the run's env reaches the CLI (a startup probe proves it) and is
  then outranked key by key.
- **Tiers work inside a pinned project.** Because the model travels free, a project that pins its
  endpoint and credential still offers a cheap/strong choice — which is the case the feature exists
  for, and the reason "pin the credential and nothing else" is not a safe configuration.
- **A profile is a patch, not a trio.** It may declare any subset of the three keys and inherits the
  rest from the server's environment. clodeck resolves a **complete** trio before applying the rule
  above, so the rule is applied to a resolution, never to raw environment variable names.
- **The picker cannot offer everything everywhere.** A patch naming a base URL or a credential is a
  *provider*; one naming only a model is a *tier*. A pinned project offers only the tier-shaped ones,
  because a model name belonging to one vendor's endpoint means nothing at another's.
- **A credential kept in a project file is readable by the model.** Measured: the file layer filters no
  dotfiles (`server/src/files/scoped-fs.ts:174-182`, `:342-357`) and `Read` is auto-approved and
  project-scoped. Hand-written project credentials are therefore readable by the agent they pay for.
  Documented, not engineered around; credentials that matter belong in server-environment profiles.
- **clodeck still persists nothing.** Profiles are read once at boot, and a session's binding lives in
  the browser. Nothing new is written to disk by this feature.

## Considered options

- **Fill the gaps — supply only the keys the project does not declare**, mirroring the SDK's own
  per-key rule because it is the SDK's own rule. Rejected: this *is* the leak. It is convenient in
  exactly the configuration that sends a credential to the wrong host.
- **Refuse to start a session in a pinned project until the pin is removed.** Rejected: it breaks the
  legitimate case — "this project is always this provider and this key" is today's behaviour, for free,
  and a per-session feature has no business forbidding it.
- **Have clodeck write the project's `.claude/settings.json`** so a session's choice sticks by being
  written into the project. Rejected: it mutates configuration the user owns, it would be global to the
  project rather than to the session, and it makes the file drawer a credential writer.
- **A per-profile directory via `Options.projectConfigRoot`**, which redirects where project settings
  are read from — the one shape that would keep the server entirely out of the credential path, since
  the SDK would read a file clodeck never parses. Rejected: it also relocates `CLAUDE.md`, the `.claude`
  config trees (commands, agents, skills, workflows, routines, output-styles), `.mcp.json` and
  `CLAUDE_PROJECT_DIR` to that directory, so choosing a provider would silently take the project's own
  configuration with it.
- **Turning filesystem settings off entirely (`settingSources: []`)** so no project could ever declare
  a provider. Rejected on the same call: it also drops `CLAUDE.md`, which clodeck wants and today gets.
