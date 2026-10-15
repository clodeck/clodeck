# Clodeck — Direct route (the deployment that needs no domain)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Ye operator ye VPS dārad bā public IP، bedune domain، va port-hā-ye 80/443/3001 bāz. Mikhād app rā az
ye browser-e dige — az phone، az har devāys — bā ye bookmark bāz kone. Kard va be do divār khord:

1. **Cookie-e session rooye `http://IP:PORT` hich vaght nemimune.** Browser cookie-e `Secure` rā az
   origin-e gheyr-HTTPS va gheyr-localhost **dur mirizad**. Server login rā **200** bargardānde va
   cookie rā ferestād، vali darkhāst-e ba'di cookie nadārad → `/api/auth/me` → 401 → safhe ye bargh
   mizane va dobare login. Bedune hich error-i.
2. **`GET /` → 404.** `WEB_ROOT`-e set-nashode be-designed client serve nemikone (dev loop ast)، vali
   README jomle-ye *"This, not the dev loop, is what you deploy"* rā zire ye onvān-e **Optional**
   gozāshte. On-chizi ke bāyad deploy bokoni، dar ye hashiye gom shode.

In do tā az yek jā miyāyand: **decision 07 `Secure` rā gheyr-e-sharti karde** (bedune off-switch),
va masir-hā-ye mojood barāye "bedune domain" yā tunnel ast (bedune phone، bedune bookmark) yā
gereftan-e ye domain. Yani **āmu-tarin deployment-e momken** dar mahsool ye divār dārad، dar hāli ke
kol-e hazf-e mahsool dastresi-e az rāh-e dur ast.

## Solution

**Public origin yek bār e'lām mishe، va cookie az un peyravi mikone.**

Operator `CLODECK_PUBLIC_URL` rā set mikone — hamoon origin-i ke browser type mikone. Scheme-e un taeen
mikone ke cookie `Secure` bāshe yā na. Set nashode → raftār-e emrooz (`Secure`، hamishe). Pas ye
upgrade hich chizi rā badel nemikone.

In yek vāzhe ast ke **hame-ye masir-hā** rā javāb mide:

| Masir | `CLODECK_PUBLIC_URL` | Cookie |
|---|---|---|
| Direct (IP، bedune domain) | `http://203.0.113.10:3001` | gheyr-`Secure`، bā warn |
| Proxied (Caddy + domain) | `https://clodeck.example.com` | `Secure` |
| Tunnelled | `http://localhost:3001` | `Secure` (localhost mostasnā ast) |

In un chizi ast ke app **nemitoone khodesh befahme**: posht-e Caddy، app az proxy **http** mibinad va
browser **https** dārad — pas hich chiz dar un darkhāst goyā-ye haqiqat nist. `X-Forwarded-Proto` ham
javāb nist، chon `trustProxy` rā lāzem dārad va rate-limit-e login rooye `request.ip` key mishavad،
yani header-e jā'li ham ghofl rā dor mizane ham āدرس jā'li misāze.

**Bedune in vāzhe، do divār-e dige ham baste mishan:** `WEB_ROOT` be client-e build-shode resolve
mishe، va ye `npm run serve` build+start+preflight rā yek command mikone.

**Hazine sarih ast va bāyad sarih bemoone:** rooye masir-e direct، password va kol-e chat va kol-e
output-e terminal rooye network **cleartext** mire. In ye entekhāb-e āgāhāne ast — pas server log
mikone va safhe-ye login ham miguyd — na ye chizi ke sar-pushide shode.

## User Stories

1. As an operator with a server, a public IP and no domain, I want to open the app in a browser at that
   IP and port, so that I do not have to obtain a domain to use the product.
2. As an operator, I want to bookmark the app on my phone, so that I can reach it without a laptop and
   without holding a tunnel open.
3. As an operator, I want to reach the app from any browser on any device, so that nothing has to be
   installed on the client.
4. As an operator, I want to declare how the app is reached exactly once, so that I do not reason about
   TLS, cookies and bind addresses separately.
5. As an operator, I want an undeclared public origin to change nothing, so that upgrading the app does
   not change the security of a deployment that already works.
6. As an operator behind a TLS-terminating proxy, I want to declare the origin the browser uses rather
   than the one the app sees, so that the cookie is `Secure` even though the app receives plain HTTP.
7. As a security-conscious operator, I want the cookie to stay `Secure` on every HTTPS origin, so that
   a proxied deployment loses nothing to this change.
8. As a security-conscious operator, I want a malformed public origin to keep the cookie `Secure` and
   warn, so that a typo can never silently produce an insecure session.
9. As an operator, I want the app to bind loopback unless I say otherwise, so that a deployment cannot
   silently reopen a port I deliberately closed.
10. As an operator, I want the built client served when the web root is unset and the build exists, so
    that `GET /` is the app rather than a 404.
11. As a developer, I want an unset web root with no build present to keep today's behaviour, so that
    the Vite dev loop is untouched.
12. As an operator, I want a log line naming the client directory that was picked, so that "am I serving
    the build I think I am" is answerable.
13. As an operator, I want a log line telling me no client is being served, so that a 404 on `/` is
    explained rather than mysterious.
14. As an operator, I want one command that builds and starts the app, so that deploying is not a
    sequence of steps I have to remember in order.
15. As an operator, I want that command to name a missing password or projects root plainly, so that I
    am not left staring at a login screen that silently refuses everything.
16. As an operator on a plain-HTTP origin, I want a warning at startup, so that the trade-off is
    visible even if I never open the README.
17. As an operator on a plain-HTTP origin, I want the login screen to say the connection is not
    encrypted, so that I am warned at the moment I type the password.
18. As an operator, I want no extra acknowledgement flag, so that the safe path stays the default and
    the risky one stays a single setting.
19. As an operator who wants encryption without a domain, I want the internal-certificate route
    documented with its caveat, so that I know what it costs on mobile before I try it.
20. As an operator, I want the tunnel documented beside the direct route, so that I can choose
    encryption when I do not need a phone.
21. As a reader of the README, I want the situation table to lead with the direct route, so that the
    most ordinary deployment is the first thing I see.
22. As a maintenance engineer, I want the WebSocket origin check left exactly as it is, so that the
    same-origin rule that already admits every host keeps working.
23. As a maintainer, I want the reversal recorded in an ADR and its vocabulary in the glossary, so that
    "why is this cookie not always `Secure`?" is answerable from the repo.

## Implementation Decisions

### The public origin

- **`ServerConfig` gains `publicOrigin`.** Read from `CLODECK_PUBLIC_URL` (trimmed); unset or blank →
  `null`. Env-only, like `UI_PASSWORD` and `WEB_ROOT` — it describes a deployment, not the projects
  root, so the config file (which carries only `projectsRoot`) is not extended.
- **It drives the session cookie and nothing else.** The auth transport derives the cookie's `secure`
  flag from the declared scheme — both on login and on logout, so the clear-cookie matches. `HttpOnly`,
  `SameSite=Strict`, `Path`, and the 7-day window are untouched.
- **`null` means `Secure`.** The fail-safe default is today's behaviour; an undeclared origin is not an
  insecure one.
- **A malformed value warns and stays `Secure`.** It never fails open. Refusing to boot over a URL typo
  was considered and rejected: a safe fallback plus a loud line is recoverable, a dead server is not.
- **The value is compared by scheme, not by host.** Host matching would break the tunnelled and LAN-IP
  routes and buys nothing.
- **The WebSocket origin check is not touched.** It compares `Origin`'s host to the request's `Host` and
  deliberately ignores the scheme. It already admits a bare origin, it is spoof-resistant, and coupling
  it to this variable would narrow it to one hostname. This is called out in the ADR so a reader who
  expects the new variable to reach that code finds the reason first.

### The web root

- **`ServerConfig.webRoot` resolves when `WEB_ROOT` is unset:** walk up from the working directory to
  the directory whose package manifest declares workspaces, then use `web/dist` there if it exists.
  Otherwise `null` — today's behaviour, exactly.
- **The resolver takes its starting directory as an argument.** Otherwise its test would depend on the
  machine's own build output, which is the one thing a test of path resolution must not do.
- **The resolution is logged either way** — which directory was picked, or that none was and why. The
  silent 404 is the bug being fixed as much as the missing default is.
- **`WEB_ROOT` explicitly set still wins**, unchanged.

### The serve script

- **Root `package.json` gains `serve`:** a preflight, then the build, then the server started against
  the resolved web root.
- **The preflight reads the loaded config and returns a list of problems.** It reports a missing
  `UI_PASSWORD` and a missing `PROJECTS_ROOT` in plain language and exits non-zero. Today both are
  silent: an unset password is fail-closed on every route, and an unset projects root is an empty list
  with a warning nobody reads. For a deployment script both are mistakes worth stopping for.
- **The preflight is a pure function of the config**, so it is unit-tested rather than exercised by
  running a build.

### The warnings

- **Startup:** when the declared origin's scheme is `http:` and its host is not loopback, the server
  logs one unmissable line naming the variable and the trade-off.
- **The login screen:** derived client-side from `location` — `http:` and a hostname outside the
  loopback set (`localhost`, `127.0.0.1`, `[::1]`). No API change: the rule is the browser's own rule,
  and the client already knows the origin it was loaded from. The predicate is a pure function.
- **No acknowledgement flag.** Decision 1 of the originating decision removed decisions; adding one
  back would defeat it.

### The docs

- **README's situation table leads with the direct route** for "single-user server, no domain", with the
  cleartext cost in the same row; the tunnelled route stays beside it as the encrypted alternative.
- **`### The one rule: HTTPS, or localhost` stops being a rule** and becomes the direct route's entry,
  with its cost stated. **`### Why a plain-HTTP address cannot hold a login`** and its "the fix is not to
  weaken the cookie" are rewritten: the failure mode is still worth documenting, but as a symptom of an
  undeclared origin rather than as a law.
- **The `Optional` heading that hid the deploy path is re-shelved.** The deploy path is the path.
- **The internal-certificate route (Caddy's `tls internal`) is documented as the encrypted alternative**
  — one paragraph and one block — with its caveat stated: the certificate comes from a local authority
  no browser trusts, and iOS needs the root installed rather than a warning clicked through. It is
  documentation in this slice, not a verified route.
- **`AGENTS.md` §"Standing decisions"** — the auth line ("single-account login over HTTPS") gains the
  direct route.
- **Superseded pointers** on wayfinder decision 07 and its line in the wayfinder map, and on the auth
  spec's "no off-switch in MVP" line. The map is closed and is not rewritten; what must not survive is a
  reader taking its decision for current.

### Verification

- **The Playwright layer gains a spec that runs against a non-localhost origin.** Today's config points
  it at `http://localhost:5173`, and loopback is exempt from the `Secure` rule — so a spec on today's
  base URL **passes with the bug present**. The new spec drives the built client, served by the server
  with a resolved web root, on the machine's own LAN address, resolved at runtime; where there is no
  such address it skips rather than lies.

## Testing Decisions

- **What makes a good test:** assert external behavior only — the status code, the `Set-Cookie` header,
  the served body — never a private helper. The one exception is the set of pure functions the design
  introduces, which are tested directly because that is what they are for.
- **One seam: `buildApp`.** Everything the server does for this feature is observable through it, and
  `AppOptions` gains nothing: the public origin is configuration, not a seam — the same reasoning the
  static-serving slice applied to the web root ("there is nothing to fake").
- **The cookie contract is asserted where it already is.** The auth transport suite currently asserts
  that the session cookie carries `Secure`. It gains the complementary cases: a declared `http:` origin
  produces no `Secure`; a declared `https:` one and an undeclared one both keep it; the clear-cookie on
  logout matches. Prior art: that suite's existing login/logout assertions.
- **Serving the built client** extends the existing static suite: an auto-resolved web root against a
  fixture directory, an unset root with no build → 404, and an explicit `WEB_ROOT` → today's behaviour.
  The suite already covers the SPA fallback and the gate winning over the catch-all; both must still
  hold.
- **A bare origin does not break the sockets.** The WS suites assert that an unauthenticated upgrade is
  refused and that a same-origin one is admitted; a case pins that the origin check is unaffected by the
  new variable.
- **The pure functions are tested directly:** the web-root resolver against fixture directories (no
  dependence on this machine's build), the preflight across missing/blank/present values, and the client
  predicate across `http:`/`https:` and loopback/non-loopback hosts.
- **The login screen is tested through rendering**, not through the predicate alone: the warning appears
  on a non-loopback `http:` origin and is absent on `https:` and on loopback.
- **`npm run serve` is verified by running it**, the same posture the image takes: its logic is covered
  by the preflight's unit tests and its wiring by one recorded run. No test mocks npm.
- **The end-to-end spec is the acceptance test.** It drives login → chat → terminal → file drawer in a
  real browser against a real server on a non-loopback origin. It is not part of `npm test`, and it
  needs the dev pair up, exactly like the existing specs.

## Out of Scope

- **The login rate limiter behind a proxy.** `request.ip` is keyed without `trustProxy`, so behind Caddy
  every login shares one bucket and five failures lock out the legitimate user too. It is a real bug in
  today's compose deployment and it is **its own ticket**: the fix is a security decision, because
  trusting `X-Forwarded-For` makes the lockout defeatable by a header.
- **Verifying the Let's Encrypt path.** Ticket 30 recorded it as never verified for want of a public
  domain; it stays unverified, and the direct route is what makes it unnecessary for this operator.
- **Direct TLS inside the app** (certificate paths wired into the server). Caddy terminates; the app
  keeps serving plain HTTP on the compose network.
- **Making the internal-certificate route a tested route.** Documented with its caveat, not verified.
- **Multi-user, per-user scoping, a persistent session store, CSRF tokens** — unchanged from the auth
  slice's own out-of-scope list.
- **Git explorer, plugins, browser-use, model picker** — out of MVP per `AGENTS.md`.

## Further Notes

- **This reverses half of wayfinder decision 07**, recorded as
  `docs/adr/0001-session-cookie-follows-public-origin.md`, together with the alternatives that were
  rejected (a `COOKIE_SECURE` boolean, `X-Forwarded-Proto`, self-signed-only) and why. The originating
  decision ticket is `.scratch/clodeck/issues/58-direct-route-decision.md`, which carries all 16 settled
  decisions in one table.
- **`GLOSSARY.md` is new**, and this slice is why it exists: **deployment**, **deployment route**,
  **direct route**, **tunnelled route**, **public origin**. Use those words in the tickets.
- **The mechanism is one expression; the work is the contract around it.** Routing the cookie through a
  declared origin is a change of one line in the auth transport. Everything else here — the resolution
  of the web root, the preflight, the two warnings, the docs, the non-loopback acceptance test — exists
  so that the operator never has to know that line exists.
- **The dev loop is deliberately unchanged.** No web root resolves to nothing when no build is present,
  Vite keeps serving the client, and `npm run dev` does not go near any of this.
- **Ticket split** (for `/to-tickets`):
  - (59) **The public origin decides the cookie** — config field, auth transport, the malformed-value
    fallback, and the tests that pin the WebSocket check as untouched.
  - (60) **The web root resolves to the built client** — the upward walk, the resolver's testable
    signature, and both log lines.
  - (61) **`npm run serve`, with a preflight** — the root script, the preflight function and its tests,
    and the startup warning.
  - (62) **The login screen says the connection is not encrypted** — the predicate and the rendering
    test.
  - (63) **The docs catch up** — README (table, the two rewritten sections, the re-shelved heading, the
    internal-certificate paragraph), `AGENTS.md`, and the superseded pointers.
  - (64) **The direct route, verified in a browser** — the end-to-end spec on a non-loopback origin and
    the recorded run.

  Blockers: 59 and 60 have none and can run together. 61 needs both. 62 needs 59. 63 needs 59–62 (it
  documents behaviour, and a README describing an unbuilt flag is worse than a stale one). 64 needs
  59–61.
