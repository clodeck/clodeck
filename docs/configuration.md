# Configuration

Everything is read by the **server**, in every case; the client bakes in nothing but relative URLs.
Values come from the process environment, from `clodeck.config.json` in the server's working
directory, or from a `.env` file that a launcher (`npm run dev:env`, `start-clodeck.*`,
`docker compose`) puts in front of the process. The server itself reads no file.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PROJECTS_ROOT` | — | The directory whose immediate child directories are the projects. Unset or empty → an empty list, never an error. |
| `UI_PASSWORD` | — | The single account's password. Unset or empty → the server boots **fail-closed**: every route and socket answers 401 and no login can succeed. |
| `UI_PASSWORD_FILE` | — | Read **only** when `UI_PASSWORD` is unset: a file whose trimmed contents are the password (the Docker-secret shape). |
| `PORT` | `3001` | The server's port. The Vite dev proxy targets the same value, so `PORT=3300 npm run dev` moves both halves together. |
| `HOST` | `127.0.0.1` | The server's bind address. Loopback by default as defense in depth — the auth gate, not the bind address, is what keeps the surface closed. A container sets `0.0.0.0` because its loopback reaches nobody, and [the direct route](deployment.md#the-direct-route) sets it because other machines are the point of that route. |
| `CLODECK_PUBLIC_URL` | — | The origin a browser reaches the app at — scheme, host and port, e.g. `http://203.0.113.10:3001`. It is read for its **scheme**, and that decides the session cookie's `Secure` flag: `http:` → not `Secure`, which is what lets a bare origin hold a login ([the direct route](deployment.md#the-direct-route)) at the cost of cleartext on the wire; `https:` → `Secure`. Unset or blank → `Secure`, exactly as before, and a bare `http://` origin then bounces ([why](deployment.md#when-the-origin-is-not-declared)). Declaring the origin the browser types is also what a deployment behind a TLS-terminating proxy wants, even though the app itself sees plain HTTP. |
| `WEB_ROOT` | — | The built client's directory. Set → the server serves the SPA at `/`, auth-exempt, with an `index.html` fallback for deep links. Unset → the server walks up from its working directory to the repo root and serves `web/dist` if it has been built, logging the directory it picked or the reason it picked none. No build anywhere → no client is served, which is what the Vite dev loop wants. |
| `CLODECK_TRUSTED_PROXIES` | — | The proxies in front of this deployment, as a comma-separated list of addresses, CIDR ranges and the keywords `loopback` / `linklocal` / `uniquelocal` — `172.16.0.0/12` for the compose Caddy, `127.0.0.1/8` for a proxy on the same host. It is the address the **login lockout** keys on: without it, every login behind a proxy arrives from the proxy itself, so five failures — anyone's — lock out the one user there is. Unset or blank → nothing is trusted, which is what the direct and tunnelled routes want; a forged `X-Forwarded-For` is ignored by a peer outside the list either way, so only a client *inside* it can rotate the bucket. A value that is not a list of addresses is a startup warning rather than a failure: the server trusts nothing and says so. |
| `CLODECK_PROVIDER_<NAME>_BASE_URL`, `_AUTH_TOKEN`, `_MODEL` | — | One provider profile, named `<NAME>`: any subset of the endpoint, the credential and the model, with the rest inherited from this server's own `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`. Read once, at boot. See [Provider profiles](#provider-profiles). |
| `CLODECK_PERMISSION_MODE` | `default` | The permission mode a session starts in, and the one `New chat` returns to: `default` (Ask), `acceptEdits` (Accept edits), `plan` (Plan) or `bypassPermissions` (Bypass). Anything else **stops the boot** with the accepted list, as does `bypassPermissions` when `CLODECK_ALLOW_BYPASS` is off — a misconfigured mode would otherwise run every turn under a policy nobody chose. Read once, at boot. See [Permission modes](#permission-modes). |
| `CLODECK_ALLOW_BYPASS` | `on` | Whether **Bypass** may be chosen at all, in any session of this deployment. `on`/`off`, `true`/`false`, `yes`/`no` and `1`/`0` are read the way a shell writes them; **anything else is a warning and Bypass stays off**, because a gate's failure mode is to stay shut. Off, the server refuses Bypass with a reason and the picker says why. See [Bypass](#bypass). |
| `ANTHROPIC_API_KEY` | — | The default profile's credential, read by the Agent SDK from the server's environment. A profile's credential reaches its run the same way, as `ANTHROPIC_AUTH_TOKEN`. Clodeck never stores, persists or invents one — it reads what you exported and hands it to the run. Only the real provider needs it — `npm run dev:fake` needs none. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where the Agent SDK keeps its transcripts — the thing session history and resume are read from. The Docker image sets `/home/node/.claude` and mounts a volume there. |

### `clodeck.config.json`

The fallback for deployments that would rather not export an environment variable. It is read from the
server's working directory — which is `server/`, not the repo root, when the root scripts run it,
because npm runs a workspace script there:

```json
{ "projectsRoot": "/srv/projects" }
```

## Provider profiles

**A session does not have to run on the environment the server was started with.** A **provider
profile** is a named patch over that environment: declare any subset of the endpoint, the credential
and the model under `CLODECK_PROVIDER_<NAME>_*`, and the keys you leave out are inherited — from the
server's own `ANTHROPIC_*`, never from another profile. One endpoint with two models on it is
therefore two lines, not six.

| Variable | The key it declares |
|---|---|
| `CLODECK_PROVIDER_<NAME>_BASE_URL` | The Anthropic-compatible endpoint this profile talks to. |
| `CLODECK_PROVIDER_<NAME>_AUTH_TOKEN` | The credential it carries. |
| `CLODECK_PROVIDER_<NAME>_MODEL` | The model to ask for. |

```sh
# The endpoint and the credential are already this server's own environment, so
# each profile is a model alone — which is what a tier is.
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic \
ANTHROPIC_AUTH_TOKEN=sk-... \
CLODECK_PROVIDER_FLASH_MODEL=deepseek-chat \
CLODECK_PROVIDER_PRO_MODEL=deepseek-reasoner \
  npm run serve
```

All three keys together is a provider of its own, on a server whose environment points somewhere else:

```sh
CLODECK_PROVIDER_GROQ_BASE_URL=https://… \
CLODECK_PROVIDER_GROQ_AUTH_TOKEN=gsk-… \
CLODECK_PROVIDER_GROQ_MODEL=… \
  npm run serve
```

A profile's name is normalized — upper-cased, with `-` folded to `_` — so `deepseek-flash` and
`DEEPSEEK_FLASH` are one profile, and the picker lists the normalized spelling. A key under the prefix
that names no profile, or names none of the three, is reported on the server's first lines rather than
silently ignored.

**The reserved `default` profile is the server's own environment.** With nothing declared the picker
offers exactly one entry — *server environment* — and every run is the run it has always been, so **a
deployment that declares no profile changes in no way at all**. A name that clashes with `default` is
refused with a warning rather than obeyed. Profiles are read **once, at boot**: adding or changing one
is a restart, the same deliberate act as changing the password.

**The credential rule, in one line: the endpoint and its credential travel together, and the model
travels free.** A project can pin its own provider, and when it does Clodeck sends the model and
nothing else — the two halves of a host-and-credential pair never come from different sources. The
measurements this rests on, and the five alternatives that were rejected, are in
[ADR 0002](adr/0002-provider-credentials-travel-with-their-endpoint.md).

**Clodeck speaks one API, so every other vendor arrives through a proxy.** A profile's endpoint has to
be **Anthropic-compatible**: Clodeck talks the Anthropic Messages API and nothing else, and it grows no
translation layer. DeepSeek's `/anthropic` surface is one out of the box; a vendor without one reaches
you through a **translation proxy the operator runs**, with a profile pointed at that. The chat surface
is only as good as what the proxy passes through unaltered — `stream_event` deltas (the live bubble),
`tool_use` blocks (the tool cards), the `can_use_tool` approval round trip those blocks trigger (the
modal), and the trailing `result` (the turn's outcome).

**The picker sits beside the composer** — above the box you type in, not up in the chat header — as one
line reading `running on <model> · <profile>`. The choice is **per session**: a new session in a
project opens on the profile the last one there used, and on the server's environment when nothing is
remembered. It **locks once the session's first turn has run**, so what you are talking to cannot
change mid-conversation; a different profile means a new session, and **`New chat` in the chat header
is that door** — it drops the transcript, the session and the armed resume, and the next message
starts a session of its own (nothing is written to disk until that send). Reloading the page is a new
session too, because the binding lives in the browser and nowhere else. The picker is told names and
models, and of a pinned project's file only the endpoint it declares (which you can read in the drawer
too) — **never a credential** — and a profile the operator has since removed is refused by name, never
quietly swapped for the default. Each run logs the profile and model it used: the only record of what
a turn actually ran on.

**A project can pin its own provider, and may then choose only a model.** If a project's
`.claude/settings.json` declares `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` in its `env` block, the
SDK gives that file precedence over the server's environment key by key, and Clodeck neither fights it
nor duplicates it: the picker says *pinned by this project* and offers **tiers only**, because one
vendor's model name means nothing at another vendor's endpoint, and the run carries the chosen model
while the project keeps the endpoint and the credential. The file is read per turn, through the same
scoped file access the drawer uses, so a pin you edit takes effect on the next turn; a file that is
missing means *no pin* in silence — most projects pin nothing — and one that is not JSON, or whose
`env` is not an object, means *no pin* with a line in the server's log. Neither is ever a reason to
fail.

**A credential written into a project file is readable by the model.** The drawer filters no dotfiles —
`.claude/settings.json` is right there in the tree — and the agent's `Read` is auto-approved and scoped
to the project, so a key hand-written into a project's settings is a key the agent it pays for can
open. That is accepted rather than engineered around, and it is why the profiles above exist: **a
credential that matters belongs in the server's environment**, which no browser is ever shown a part
of.

## Permission modes

**A session chooses what the agent may do without asking, and the composer is where.** The mode picker
sits beside the provider picker — above the box you type in, not up in the chat header — and its label
names the mode the session runs under. It **stays open after the first turn**, unlike a profile: a
provider is a transport fact that would poison the conversation, while a mode is a filter for what
comes next. **A mid-turn switch bites the calls after it, in the same turn.** The SDK's own mode
changes at once, and so does the gate Clodeck adds — the Bash prompt in Ask and Accept edits, Plan's
denials — because it reads the mode in force when each call arrives. Switching to Bypass frees the
next command without a modal; switching back to Ask parks it; switching into Plan denies the next edit
or command. The one thing a switch does not rewrite is what is already on your screen: an approval
raised before it is answered under the mode that raised it. The next turn starts in the new mode too.

| Mode on the picker | Wire value | Reads (`Read`, `Glob`, `Grep`) | `Edit` / `Write` | `Bash` |
|---|---|---|---|---|
| **Ask** | `default` | free | prompt | **prompt — every call, `ls` and `git status` included** |
| **Accept edits** | `acceptEdits` | free | free | **prompt — every call, `mkdir`, `rm` and `sed` included** |
| **Plan** | `plan` | free | **denied, no prompt** | **denied, no prompt** |
| **Bypass** | `bypassPermissions` | free | free | free |

*free* runs the call without asking; *prompt* parks it in the approval modal until you answer; *denied*
answers the agent without showing you anything, and the turn carries on — the model reads the refusal
and keeps working rather than the session stopping.

**This is Clodeck's contract, not a forwarding of the SDK's four names, and it is deliberately
stricter in three places** — the ones that surprise. **Ask** asks before a *read-only* shell command
rather than trusting the command line. **Accept edits** asks before `rm`, `mkdir` and `sed` rather than
calling them edits. **Plan** refuses edits and shell commands instead of parking them in the modal,
because nothing executes while a plan is being written and leaving Plan is a mode change, not an
approval — the plan's own exit is refused with the rest, so the session stays in Plan until you pick
another mode. A plan may still ask you a clarifying question, and the SDK's own plan file is written
without asking; neither is a project edit. The SDK's other two modes, `auto` and `dontAsk`, are not
offered: the wire refuses them, because one classifies calls where you cannot see the classifier and
the other denies silently, which in a browser is indistinguishable from a hang. The reasoning, and the
alternatives that were rejected, are in
[ADR 0003](adr/0003-permission-modes-are-a-contract-not-an-sdk-passthrough.md).

**A project's `.claude/settings.json` can tighten, never loosen.** Its `deny` and `ask` rules always
apply — in Bypass too — while its `allow` rules are neutralised for these four modes, so a project file
cannot auto-approve a call the picker says will ask. That rule is what makes the table above a promise
rather than a summary.

**The mode is session state, not a stored preference.** It starts at `CLODECK_PERMISSION_MODE` — Ask
when the variable says nothing — a `New chat` goes back to that value, a reconnect restores the run's
mode, and switching to another project and back keeps that project's run. Nothing is ever written to
disk: no project file, no registry, no session metadata, so a restart starts over at the same default.

### Bypass

**Bypass** has gates of its own, because *every tool runs without asking* is worth a deliberate click:

- **`CLODECK_ALLOW_BYPASS`** — the deployment's gate, **on** unless the operator switches it off. Off,
  the server refuses Bypass on a send and on a mid-turn switch, and the picker's row names the reason.
  A deployment that also sets `CLODECK_PERMISSION_MODE=bypassPermissions` stops at boot instead of
  running in a mode its own gate refuses.
- **The project's own settings** — `permissions.disableBypassPermissionsMode: "disable"` in
  `.claude/settings.json` refuses Bypass in that project, outranking every session in it.
- **Running as root or under sudo, outside a sandbox** — the SDK refuses Bypass outright; Clodeck lets
  that refusal fail the turn out loud rather than fall back to a quieter mode.

The deployment's and the project's gates are also what switch the SDK's own
`allowDangerouslySkipPermissions` on for a run: the capability exists exactly where they allow it, and
is set from the start, which is what keeps a mid-turn switch possible.

Choosing it asks first, **every time** — there is no "remember this" — and a persistent badge stays
beside the composer while it is active. The confirmation, the badge's tooltip and this page all carry
the same sentence:

> Every tool runs without asking. A project's own deny/ask rules in `.claude/settings.json` will still apply.

A gate you cannot see is not a gate, so a refused Bypass is still *named* in the list, with the
server's sentence under it, rather than removed.
