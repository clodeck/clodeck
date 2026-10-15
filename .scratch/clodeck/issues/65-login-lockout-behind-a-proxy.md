# 65: Behind a proxy, the login lockout locks out the legitimate user

**What to build:** In today's Compose deployment, every login shares one rate-limit bucket. The limiter
keys on the request's address and no proxy trust is configured, so Caddy's forwarded requests all arrive
from the proxy's own address — five failures, anyone's, lock out the single legitimate user for fifteen
minutes. The limit should follow the real client address, **without** handing an attacker the ability to
defeat it with a header.

**The decision is this ticket's first deliverable, and it is the operator's to take.** Trusting
`X-Forwarded-For` means trusting something a client can send; not trusting it means the lockout is
useless behind a proxy. An agent may lay out the options and a recommendation; it must not pick one and
build it silently. The choice and its rejected alternatives belong in the repo — an ADR if it turns out
to be a product decision, this ticket if it is a deployment one.

Called out as its own ticket by the direct-route decision (`.scratch/clodeck/issues/58-direct-route-decision.md`,
decision 16). It is not part of that slice and blocks nothing in it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The chosen address source is written down with the failure mode it accepts: what happens when the
      header is absent, when it lies, and when the app is reached directly with no proxy in front.
- [ ] Behind a proxy, a run of failures from one client address locks **that** address, and a different
      address can still log in.
- [ ] A forged forwarding header cannot lock out the legitimate user, or if it can, that is stated as the
      accepted cost rather than left implicit.
- [ ] The lockout still holds with no proxy in front — the direct route and the tunnelled route keep the
      behaviour they have today.
- [ ] Tests drive the limiter through the transport under both topologies: a forwarded request behind a
      proxy, and a direct one. The clock stays injectable, so no test waits out a lock.
- [ ] `npm run typecheck` and `npm test` pass.

## The decision (taken by the operator, 2026-10-15)

**B — a declared trust list: `CLODECK_TRUSTED_PROXIES`.** An env-only value in the same posture as
`CLODECK_PUBLIC_URL`: a CIDR/list string handed straight to `Fastify({ trustProxy })`, which splits it on
`,` and knows `loopback` and `uniquelocal`. Unset means nothing is trusted, which is today's behaviour
exactly — so the direct route and the tunnelled route keep the bucket they have now. The compose file
declares Docker's own pool (`172.16.0.0/12`), so that topology is fixed without the operator doing
anything; the README states the other two (a proxy on the host → `127.0.0.1/8`; direct or tunnel →
unset).

The failure modes it accepts, which are what the first checklist item is for:

| Where the request comes from | What the bucket keys on |
|---|---|
| no header (direct, tunnel) | the real peer address — unchanged |
| a header that lies, from an untrusted peer | ignored: the key is the last hop a trusted peer added, so a forged prefix changes nothing |
| a forged header from **inside** a declared range | the bucket can be rotated — the accepted cost, and the reason the value is declared rather than defaulted |

**Rejected:**

- **A — trust nothing (today).** Every login behind Caddy shares one bucket, so five failures from
  anyone lock out the single legitimate user for fifteen minutes. This is the ticket's reason to exist.
- **C — `trustProxy: true`.** One line and no variable, but the key is the *leftmost* `X-Forwarded-For`
  entry, which is entirely client-controlled: an attacker is never locked and can burn any address's
  bucket, the legitimate user's included. This is the "defeat it with a header" the ticket forbids.
- **D — trust `uniquelocal` peers, no variable.** Zero-config, and it fixes compose too, and on a public
  VPS a forged header is ignored because the peer is public. But the trust becomes implicit where this
  repo declares its posture (`HOST`, the public origin), and any peer inside a private range — this
  effort's own LAN deployment (ticket 64) included — can rotate the bucket. Declaring beats defaulting.

A malformed value is a **warning plus the no-trust fallback**, not a boot failure — the posture
`sessionCookieIsSecure` already takes for an unusable origin. The ADR is the implementation's: it amends
`docs/adr/0001-session-cookie-follows-public-origin.md`'s claim that trusting the header makes the
lockout spoofable, which stays true of the header *alone*.
