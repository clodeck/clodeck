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

**Status:** resolved

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

## What landed

```
package.json           "serve": the preflight, then the build, then the server — one command.
server/package.json    "preflight": tsx src/preflight-cli.ts — from source, before the build.
server/src/preflight.ts        preflightProblems(config): the pure verdict, no I/O.
server/src/preflight-cli.ts    the command: read the config, print, exit non-zero — or say what is served.
server/src/public-origin.ts    cleartextOriginWarning(origin): the one startup line, pure.
server/src/main.ts             logs it, after the listening line.
server/src/preflight.test.ts        8 cases: missing, blank and present, both variables, both doors.
server/src/public-origin.test.ts    5 cases: non-loopback http:, the three loopback spellings, https:,
                                    undeclared, and a value that is not an origin at all.
```

## Decisions the spec did not pin

- **The preflight runs as a server-package script, from source, through `tsx`.** It has to run *before*
  the build, so it cannot be `dist/`; running it in the server package's directory is what makes it read
  the same environment and the same `clodeck.config.json` the server reads moments later. `npm run serve`
  is therefore the chain (`preflight && build && start`), not a script of its own.
- **The client-directory line reads `config.webRoot`** — the same field the server starts from — so this
  log and the server's own line cannot disagree about which directory is being served. An unset root is
  not a problem for a preflight: the built client is resolved at startup (ticket 60), and the line says
  that rather than guessing at the answer.
- **The warning is logged by `main.ts`**, not by the preflight: the spec puts it at *startup*, and it is
  a fact about the running process rather than about the configuration. `dev:fake` is a dev loop with no
  deployment behind it, and is left alone.
- **Blank stays the loader's rule.** `preflightProblems` answers on `null` — by the time a config
  reaches it, an exported-but-empty variable is already `null` — and the blank cases are asserted
  through `loadConfig`, which is the door that applies the rule.

## Evidence

**It refuses to start.** `npm run serve` with neither variable configured — the build never runs:

```
> clodeck@0.0.0 serve
> npm run preflight --workspace @clodeck/server && npm run build && npm start --workspace @clodeck/server

> @clodeck/server@0.0.0 preflight
> tsx src/preflight-cli.ts

clodeck: the configuration is not servable — nothing was built:
  - UI_PASSWORD is not set: the server would boot fail-closed and refuse every login. Set UI_PASSWORD, or UI_PASSWORD_FILE to a file holding it.
  - PROJECTS_ROOT is not set: the project list would be empty. Set PROJECTS_ROOT, or "projectsRoot" in clodeck.config.json.
exit=1
```

**It builds and starts.** The recorded run, on this machine on 2026-10-15 (LAN address `172.17.0.3`, so
the declared origin is a non-loopback plain-HTTP one deliberately — that is what ticket 62 and the
warning are about):

```
CLODECK_PUBLIC_URL=http://172.17.0.3:3001 UI_PASSWORD=dev PROJECTS_ROOT=/tmp/clodeck-projects \
  WEB_ROOT=$PWD/web/dist npm run serve

clodeck: preflight ok
clodeck: serving the client from /home/agent/workspace/web/dist
    … tsc for shared, server and web; Vite built the client in 653ms …
clodeck server listening on http://127.0.0.1:3001
CLODECK_PUBLIC_URL is http://172.17.0.3:3001: plain HTTP on a non-loopback host, so the password, every chat message and every byte of terminal output cross the network in cleartext. Reach the app at an https: origin — a TLS-terminating proxy, or an SSH tunnel — to encrypt them.

GET  /healthz                → 200
GET  /                       → 200 text/html   (the client the command just built)
GET  /api/projects           → 401 {"error":"authentication required"}
POST /api/auth/login {dev}   → 200 {"ok":true}
     set-cookie: clodeck_session=…; Max-Age=604800; Path=/; HttpOnly; SameSite=Strict
```

`WEB_ROOT` is set in that run because resolving an *unset* one is ticket 60's work and 60 is not in this
branch. What the preflight prints for an unset root — "the server logs the one it resolves at startup" —
is the line 60's startup log will fill in.

Both halves of the checklist that a unit test cannot reach were therefore verified by running the
command, and none of the preflight's own behaviour depends on this machine's build.

## Code review

Two fixes, both in comments this branch introduced — no behaviour changed, and the suite's 13 cases are
untouched.

- **The loopback set claimed a wider rule than it is.** `public-origin.ts` said `localhost`, `127.0.0.1`
  and `[::1]` are "the hosts a browser treats as a secure context". The browser's
  potentially-trustworthy set is *wider* — it also covers `127.0.0.0/8` and `*.localhost` — so a reader
  trusting that sentence would widen the set and silence the warning on a spelling spec-07 does not name.
  The comment now says what is excused, why loopback is silent at all (the traffic stays on the machine,
  or is already inside an SSH tunnel), and why erring narrow is the safe direction for a warning about
  cleartext. Ticket 62's branch fixed exactly this overstatement in its own copy of the set (`608400a`).
- **`main.ts` named the wrong module for the malformed-origin line.** It is the auth transport's
  (`sessionCookieIsSecure` — the module `public-origin.ts` itself points a reader at), while `options.ts`
  says at length that it decides nothing about the origin. The comment names the transport now, and the
  local holding the line is `cleartextWarning` rather than `cleartext`, because the value is a message and
  not a scheme.

Noted, deliberately not changed:

- **"Reach the app at an https: origin — a TLS-terminating proxy, or an SSH tunnel"** is one claim too
  wide. A tunnel hands the browser `http://localhost`, which is loopback and not an `https:` origin — it is
  the encrypted alternative for a different reason (loopback is excused, the SSH hop is what encrypts).
  Left as it is because this is the operator-facing line the Evidence section above records verbatim, and
  rewording it changes what the command prints; it is a wording question for ticket 63's docs pass.
- **The client-directory line multiplies once 60 lands.** 60 prints its resolution through `warn` from
  inside `loadConfig`, and this preflight calls `loadConfig` too — so after both merge, a `npm run serve`
  prints the resolution from the preflight's own `loadConfig` (60's wording), then this file's own line,
  then once more when the server boots. All of them read the same `config.webRoot`, so the checklist's
  "cannot disagree" still holds; whoever merges 60 after 61 should settle on one wording for them.
