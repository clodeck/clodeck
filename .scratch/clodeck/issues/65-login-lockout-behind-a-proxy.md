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
