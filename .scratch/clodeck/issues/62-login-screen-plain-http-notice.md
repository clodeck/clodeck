# 62: The login screen says the connection is not encrypted

**What to build:** On the **direct route** the password is typed over a connection with nothing
encrypting it. The one screen that exists for that moment says so — discreetly, and only when it is
true. On `https:` and on loopback there is nothing to say.

The rule is the browser's own rule, and the client already knows the origin it was loaded from, so this
is derived client-side. No API change, no new endpoint, no server round trip.

**Spec:** `.scratch/clodeck/spec-07-direct-route.md` (§"The warnings").

**Blocked by:** 59 (without it the direct route does not actually work, and a notice about a route that
cannot hold a login is noise)

**Status:** ready-for-agent

- [ ] On an `http:` origin whose hostname is outside the loopback set (`localhost`, `127.0.0.1`,
      `[::1]`), the sign-in screen carries a discreet notice: the connection is not encrypted, and the
      password crosses the network in the clear.
- [ ] On `https:`, and on any loopback host, the notice is absent. No nagging where there is no risk.
- [ ] The predicate is a **pure function** of the origin, tested directly across `http:`/`https:` and
      loopback/non-loopback hosts.
- [ ] **The rendering is tested too, not just the predicate:** the notice appears on a non-loopback
      `http:` origin and is absent on `https:` and on loopback.
- [ ] The notice gates nothing: the password field, the button and every refusal message behave exactly
      as they do today.
- [ ] `npm run typecheck` and `npm test` pass.
