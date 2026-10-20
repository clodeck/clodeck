# Clodeck

A single-user web UI that puts Claude Code behind a browser, on a dedicated server that also holds
every project directory. This glossary names the vocabulary of *getting it running, powering it, and
reaching it* — the part of the product an operator meets before they ever sign in.

## Language

**Deployment**:
Making the app reachable from a browser on another machine, and keeping it that way.
_Avoid_: install, run, setup, serve

**Deployment route**:
One of the documented ways a deployment reaches a browser. Each has its own prerequisites and is
picked before the app starts.
_Avoid_: deploy mode, option, setup path

**Direct route**:
The deployment route where a browser reaches the app at a bare origin with nothing terminating TLS in
front of it. The only route whose session cookie cannot be `Secure`.
_Avoid_: direct mode, HTTP mode, insecure mode, plain mode

**Tunnelled route**:
The deployment route where the app binds loopback and a browser reaches it through an SSH port
forward. Reachable only from a machine that can hold the tunnel open.
_Avoid_: tunnel mode, SSH mode

**Public origin**:
The origin a browser reaches the app at. Not necessarily the origin the app process itself sees — a
proxy terminating TLS makes the two differ, which is why the app cannot infer it.
_Avoid_: base URL, public URL, domain, external URL

**Declared trust list**:
The addresses of the proxies in front of a deployment, stated as `CLODECK_TRUSTED_PROXIES`, whose
`X-Forwarded-For` the app therefore believes. Unset means nothing is trusted, and the app keys address
decisions — today, the login lockout — on the connecting peer instead.
_Avoid_: trusted proxy, proxy allowlist, forwarded header

**Provider**:
An API endpoint a session can be run against, together with the credential and the model that go to it.
clodeck speaks exactly one API shape — the Anthropic Messages API — so any other vendor arrives through
a translation proxy the operator runs.
_Avoid_: backend, vendor, LLM, model (a model is not a provider)

**Provider profile**:
A named patch over the server's environment, exported as `CLODECK_PROVIDER_<NAME>_*`, that a session may
run on. It may declare any subset of the endpoint, the credential and the model; keys it leaves unset
are inherited. The reserved **default** profile is the server's own environment.
_Avoid_: config, preset, connection, account

**Tier**:
A provider profile that declares only a model — the cheap-or-strong choice available inside a project
whose endpoint and credential are fixed by the project. Not a separate concept: a tier *is* a
model-only profile.
_Avoid_: model, level, class, quality setting

**Pinned project**:
A project whose `.claude/settings.json` declares the provider's endpoint or its credential. Its pin
outranks a session's choice, because the endpoint and its credential travel together — which is why the
effective provider is always shown.
_Avoid_: locked project, fixed project, hardcoded provider

**Permission mode**:
The policy a session runs under, chosen per session and held by its run. clodeck offers exactly four —
Ask, Accept edits, Plan, Bypass — and their labels are a contract, not another name for the SDK's
constants. A project's settings can tighten a mode, never loosen it.
_Avoid_: permission level, sandbox mode, approval mode

**Ask**:
The permission mode where reads are free and every Bash call and every edit asks. The wire value is
`default`.
_Avoid_: default mode, manual mode, safe mode

**Accept edits**:
The permission mode where reads and edits are free and every Bash call still asks. The wire value is
`acceptEdits`.
_Avoid_: auto-accept, edit mode

**Plan**:
The permission mode where reads are free and edits and Bash are denied without a prompt. The wire
value is `plan`.
_Avoid_: planning mode, read-only mode

**Bypass**:
The permission mode where every call runs without a prompt. Gated by the server, by the project and by
a confirmation; a project's deny/ask rules still apply. The wire value is `bypassPermissions`.
_Avoid_: full access, god mode, skip permissions, YOLO mode
