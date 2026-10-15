# The session cookie's `Secure` flag follows the declared public origin

**Status:** accepted (2026-10-15). Supersedes the "always `Secure`, no off-switch" half of wayfinder
**decision 07** (`.scratch/web-claude-ui/issues/07-auth-permissions.md`), which
`.scratch/clodeck/spec-05-auth.md:100` restated as *"`Secure` is always on … No `COOKIE_SECURE`
off-switch in MVP."*

## Context

Decision 07 set the session cookie `Secure` unconditionally, on the argument that the app is only ever
reached over HTTPS through a proxy or over `http://localhost` — which browsers exempt from the
requirement. That covers the Vite dev loop and the Caddy-with-a-domain deployment, and nothing else.
An operator with a server, a public IP and no domain had two doors: an SSH tunnel (no phone, no
bookmark) or obtaining a domain.

The product's whole point is remote browser access, so "get a domain or hold a tunnel open" is not an
acceptable answer to the most ordinary deployment there is.

## Decision

**The session cookie's `Secure` flag follows the scheme of the declared public origin**, which the
operator states once. An `http:` public origin produces a non-`Secure` cookie and a loud warning; an
`https:` one produces today's cookie. Undeclared, the cookie stays `Secure` — the safe default is
unchanged, and an operator who sets nothing gets exactly the behaviour they get today.

## Why the app cannot decide this for itself

This is the crux, and it is why decision 07 chose "always on". Behind a proxy the app sees plain HTTP
from Caddy while the browser sees HTTPS, so the request in front of the app carries no evidence of
how the browser reached it. Reading `X-Forwarded-Proto` would mean installing `trustProxy`, which
makes every rate-limit key and address-based decision spoofable by a header.

> **Amended 2026-10-15.** `trustProxy` *is* installed now, from a **declared** trust list —
> `CLODECK_TRUSTED_PROXIES`, the addresses the operator put in front of the deployment (ticket 65,
> `.scratch/clodeck/issues/65-login-lockout-behind-a-proxy.md`, which carries the choice and the
> failure modes it accepts). The paragraph above holds for the header *alone*: what it rejects is
> believing `X-Forwarded-For` from anybody, which is `trustProxy: true`. Declared, a header from a
> peer outside the list is still ignored, and the key is the last hop a trusted peer added — so the
> lockout follows the browser and a client cannot burn an address it does not own. This does not
> re-open the decision below: a proxy header answers the cookie question only where a proxy *is*, and
> it is the direct route that needed an answer the most.

A declared origin is the one input that answers the question for every deployment route at once —
direct, tunnelled, proxied with a domain, or behind an operator's own reverse proxy — without the app
having to guess and without trusting anything a client sends.

## Consequences

- **On the direct route, secrets cross the network in cleartext.** The login password, every chat
  message, and every byte of terminal output. This is a deliberate, warned-about trade-off accepted
  for a single-user server that would otherwise be unreachable from a phone. It is the reason the
  warning must be loud and must sit where the password is typed.
- **The WS origin check does not change, on purpose.** It compares `Origin`'s host to the request's
  `Host` and deliberately ignores the scheme (`server/src/auth/transport.ts:236-254`). Coupling it to
  the declared origin would *weaken* it: the same-origin rule is spoof-resistant and already covers
  every host, while a declared-origin comparison would break the tunnelled and LAN-IP routes. A reader
  who expects the new variable to reach this code should find this paragraph first.
- **Binding stays explicit.** The declared origin drives the cookie and nothing else. Deriving
  `HOST=0.0.0.0` from it would silently reopen a port that the "my own reverse proxy" deployment
  deliberately closes.
- **The direct route is documented as the recommended path for "single-user server, no domain"**,
  with its cost stated in the same line, and the tunnelled route stays beside it as the encrypted
  alternative.

## Considered options

- **A `COOKIE_SECURE` boolean.** The operator's own first suggestion, and the smallest change. Rejected
  because it leaves three separate decisions in front of them (`HOST`, the cookie, and the web root)
  when the goal is zero — and because it cannot express the proxy case correctly at all: behind Caddy
  the honest answer is "the browser is on HTTPS" while every fact available to the app says otherwise.
- **Trusting `X-Forwarded-Proto`.** Rejected: it requires `trustProxy`, and the address-based login
  rate limiter keys on `request.ip`, so trusting the header hands an attacker the ability to defeat the
  lockout and forge addresses.
  - **Amended 2026-10-15:** that is the unqualified `trustProxy: true` this bullet was about, and it
    stays rejected. The address decisions now run on a declared trust list (ticket 65 — see the
    amendment under "Why the app cannot decide this for itself"), but the cookie decision does not
    follow them there: a proxy header answers only where a proxy is, and the route that needed this
    variable was the one with no proxy in front of it at all.
- **Leaving the cookie `Secure` and documenting self-signed TLS only.** Rejected as the sole answer:
  Caddy's internal CA is a real option and is documented as the encrypted alternative, but a browser
  warns on the certificate and iOS needs the root CA *installed*, not merely clicked through. It is not
  the friction-free path a phone bookmark needs.
