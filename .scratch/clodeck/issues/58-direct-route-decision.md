# 58: A direct route to the app — the decision, and the docs it moves

**What to build:** Nothing runnable. This is the decision ticket: record that **the app supports a
direct route** — a browser reaching it at `http://<ip>:<port>` with no TLS in front — then move every
document that says otherwise onto the new decision, *before* the code tickets write any code, so no
document contradicts the product while it is being built. This is ticket 32's and ticket 46's pattern
(docs first, then the features), for the same reason.

**Blocked by:** none

**Status:** resolved

## The decision (taken by the user, 2026-10-15)

The operator's situation, in their words: a VPS with a public IP, no domain, ports 80/443/3001 open.
They wanted to bookmark the app on a phone and open it from any browser. They tried both the Docker
route and a plain run, and hit two walls: **the session cookie never stuck on plain HTTP**, and
**`GET /` answered 404**.

The first is decision 07 working as designed. The second is not a bug in the code at all: `WEB_ROOT`
unset means the server serves no client, which is correct for the dev loop — but the README files the
sentence *"This, not the dev loop, is what you deploy"* (`README.md:208`) under a heading marked
**Optional** (`README.md:194`). The deploy-critical line is buried in an aside, and the operator paid
for it.

**A browser at a bare origin is now a supported deployment route.** That reverses the half of
wayfinder **decision 07** which made `Secure` unconditional — the cookie stays `Secure` by default, it
stops being unconditional. Recorded as `docs/adr/0001-session-cookie-follows-public-origin.md`.

## The decisions this settles

Distilled from a grilling session; each is a decision the user owns, taken 2026-10-15.

| # | Decision |
|---|---|
| 1 | **"Simpler" means fewer decisions for the operator**, not merely fewer commands. Nothing should require them to reason about TLS, cookies, or the web root. |
| 2 | The wall was the **reach** phase, plus the buried `WEB_ROOT` requirement. |
| 3 | **A direct route is a hard requirement** — `http://IP:PORT`, no SSH tunnel, so a phone or any browser can bookmark it. |
| 4 | The route must be designed **for every deployment**, not just this operator's VPS. |
| 5 | This is a **product change**, documented and first-class — not a personal workaround. |
| 6 | **Both paths ship:** the direct route as code, and `tls internal` (Caddy's internal CA) documented as the encrypted alternative. |
| 7 | **One variable, `CLODECK_PUBLIC_URL`, is the single source of truth** for the public origin — no `COOKIE_SECURE` boolean. Unset keeps today's fail-safe (`Secure`, always). |
| 8 | It drives the **cookie only**. The WS origin check is left alone, and `HOST` stays explicit. |
| 9 | **`HOST` derives from nothing.** Default `127.0.0.1`; the operator sets `0.0.0.0` when they mean it. Deriving it would silently reopen a port the "my own proxy" deployment closes. |
| 10 | **`WEB_ROOT` auto-resolves** to `<repo>/web/dist` when unset and that directory exists, with a log line naming the choice. Absent, today's dev-loop behaviour stands, with a clear log line instead of a silent 404. |
| 11 | **A preflight** in the new `npm run serve` script checks `UI_PASSWORD` and `PROJECTS_ROOT` and fails with a plain message, instead of today's silent fail-closed. |
| 12 | **The warning is loud and located twice:** a startup log line, and a discreet note on the **login screen** — where the password is typed, which is the moment the risk is real. |
| 13 | **No extra acknowledgement flag** (no `--i-know`). It would be one more decision, which is what decision 1 removes. |
| 14 | **README's situation table gains a row, and the direct route leads it** for "single-user server, no domain", with the cleartext cost in the same line. The tunnelled route stays beside it as the encrypted alternative. |
| 15 | **Acceptance includes a real browser run** (login → chat → terminal → file drawer) *and* a Playwright spec on a **non-localhost origin** — loopback is exempt from the `Secure` rule, so a loopback spec passes even with the bug present. |
| 16 | The **rate-limit bug behind a proxy is a separate ticket.** `request.ip` plus no `trustProxy` means every login behind Caddy shares one bucket, so five failures lock out the legitimate user too. Fixing it needs its own security decision. |

## What stays exactly as it was

- **The cookie is `Secure` unless an `http:` public origin is declared.** An operator who upgrades and
  sets nothing sees no change at all.
- **`SameSite=Strict`, `HttpOnly`, the 7-day idle window, and the origin check** (decision 07 §1, §8)
  are untouched.
- **The WS origin check** (`server/src/auth/transport.ts:236-254`) compares `Origin`'s host to the
  request's `Host` and ignores the scheme, deliberately. It already admits a bare origin and covers
  every host; it is not coupled to the new variable.
- **The auth gate, the login rate limiter, and the fail-closed default** are unchanged.
- **The container still binds `0.0.0.0` internally** and publishes no port; Caddy remains the single
  way in for the compose route.

## The work: the docs

- [x] `GLOSSARY.md` — created, with the vocabulary this decision needed: **deployment**, **deployment
      route**, **direct route**, **tunnelled route**, **public origin**.
- [x] `docs/adr/0001-session-cookie-follows-public-origin.md` — created: the reversal, why the app
      cannot infer the origin itself, the cleartext consequence, and the rejected alternatives (the
      boolean, `X-Forwarded-Proto`, self-signed-only).
- [x] This ticket — the record the code tickets read.
- [ ] `AGENTS.md` §"Standing decisions" — the auth line ("single-account login over HTTPS") gains the
      direct route.
- [ ] `README.md:234` `### The one rule: HTTPS, or localhost` — the heading is no longer a rule. It
      becomes the direct route's entry with its cost stated, and the tunnel becomes the alternative.
- [ ] `README.md:227-232` the situation table — the direct route leads it for "no domain".
- [ ] `README.md:194` — the "Optional" heading that hid the deploy path is re-shelved.
- [ ] `README.md:524` `### Why a plain-HTTP address cannot hold a login` and `README.md:561` "The fix
      is not to weaken the cookie" — both become false and are rewritten.
- [ ] `.scratch/web-claude-ui/issues/07-auth-permissions.md` and its line in
      `.scratch/web-claude-ui/map.md` — a **superseded** pointer. The wayfinder map is closed and is not
      rewritten; what must not survive is a reader taking its decision for current.
- [ ] `.scratch/clodeck/spec-05-auth.md:100` (`No COOKIE_SECURE off-switch in MVP`) — the same
      superseded pointer.

The last four are deliberately left to the code tickets, not done here: they name behaviour that does
not exist yet, and a README that describes an unbuilt flag is worse than one that is merely stale.

## What landed

Docs only — no code, no `buildApp`/route change, no test.

```
GLOSSARY.md                              created: the deployment-route vocabulary
docs/adr/0001-session-cookie-…md         created: the reversal of decision 07, with the alternatives
                                         that were rejected and why
.scratch/clodeck/issues/58-…md           this record
```

## Why a separate ticket and not a line inside the code tickets

The code tickets can be implemented, reviewed and reverted; this decision cannot — it is the kind of
call that outlives the code and that the next session has to be able to find (wayfinder's own
"decisions, not deliverables"). It is also the input the spec and the tickets are written *from*: 16
settled decisions that would otherwise live only in a conversation window.

## Reference

- Wayfinder decision 07 — `.scratch/web-claude-ui/issues/07-auth-permissions.md`, and its line in
  `.scratch/web-claude-ui/map.md`.
- `.scratch/clodeck/spec-05-auth.md:96-100` — "Cookie — `@fastify/cookie`, one cookie, always `Secure`".
- `server/src/auth/transport.ts:211-224` — the cookie, and the comment stating there is no off-switch.
- `server/src/auth/transport.ts:236-254` — the origin check that stays as it is.
- `server/src/config.ts:63-66`, `server/src/app.ts:112` — `WEB_ROOT` unset means no client is served.
- `server/src/main.ts:31-32` — `PORT` and `HOST`, the latter defaulting to loopback.
- Tickets **32** and **46** — the same shape: a decision recorded in the docs before the code that
  needs it.
