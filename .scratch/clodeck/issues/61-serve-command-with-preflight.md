# 61: `npm run serve` — one command that builds and starts, with a preflight

**What to build:** One command builds the app and starts it against the resolved web root, so deploying
is not a sequence of steps an operator has to remember in order. Before it starts, a preflight reads the
loaded config and stops with a plain message when `UI_PASSWORD` or `PROJECTS_ROOT` is missing. And when
the declared origin is plain HTTP on a non-loopback host, startup logs one unmissable line naming the
variable and what it costs.

Both of those are silent today: an unset password is fail-closed on every route, so the operator stares
at a login screen that refuses every value, and an unset projects root is an empty list with a warning
nobody reads. For a deployment command both are mistakes worth stopping for.

**Spec:** `.scratch/clodeck/spec-07-direct-route.md` (§"The serve script", §"The warnings").

**Blocked by:** 59 (the declared origin is what the startup warning reads), 60 (the resolved web root is
what the command serves)

**Status:** ready-for-agent

- [ ] The root package gains one `serve` command: a preflight, then the build, then the server started
      against the resolved web root.
- [ ] **A missing `UI_PASSWORD` and a missing `PROJECTS_ROOT` each stop it**, in plain language, with a
      non-zero exit. Present values pass. Blank counts as missing, as it does in the loader.
- [ ] **The preflight is a pure function of the loaded config**, returning a list of problems, so it is
      unit-tested rather than exercised by running a build. `npm run serve`'s own wiring is verified by
      running it once and recording the run; no test mocks npm.
- [ ] **Startup logs one unmissable line** when the declared origin's scheme is `http:` and its host is
      not loopback: it names `CLODECK_PUBLIC_URL` and states the trade-off — the password, every chat
      message and every byte of terminal output cross the network in cleartext. A loopback origin and an
      `https:` origin log nothing.
- [ ] **No acknowledgement flag.** The safe path stays the default and the risky one stays a single
      setting; adding a flag back would reinstate exactly the decision the originating decision removed.
- [ ] A reader of the log can tell which client directory is being served, consistently with ticket 60's
      line.
- [ ] Preflight tests cover missing, blank and present values for both variables.
- [ ] `npm run typecheck` and `npm test` pass.
