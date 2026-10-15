# 63: The docs catch up

**What to build:** Every document that says the app cannot be reached at a bare origin — and every
document that hides the deploy path — moves onto the **direct route**. The README leads with it for
"single-user server, no domain" and states its cleartext cost in the same line, so the most ordinary
deployment is the first thing a reader sees and its price is on the same row. The encrypted alternatives
stay beside it, including the internal-certificate route with its caveat.

This ticket runs **after** the behaviour exists. A README describing an unbuilt flag is worse than a
stale one.

**Spec:** `.scratch/clodeck/spec-07-direct-route.md` (§"The docs").

**Blocked by:** 59, 60, 61, 62 — it documents their behaviour, all of it

**Status:** ready-for-agent

- [ ] The README's **situation table** leads with the direct route for "a server, no domain, just you",
      with the cleartext cost in the same row; the **tunnelled route** stays beside it as the encrypted
      alternative.
- [ ] **`### The one rule: HTTPS, or localhost` stops being a rule** and becomes the direct route's
      entry, with its cost stated.
- [ ] **`### Why a plain-HTTP address cannot hold a login`**, and its "the fix is not to weaken the
      cookie", are rewritten. The failure mode is still worth documenting — a login that answers 200,
      logs a success and then bounces you back to the sign-in screen — but as the **symptom of an
      undeclared origin** rather than as a law of the product.
- [ ] **The `Optional` heading that buried the deploy path is re-shelved.** The deploy path is the path,
      and `npm run serve` (ticket 61) is how it is taken.
- [ ] The declared **public origin** joins the README's configuration table, with its default (unset =
      `Secure`, exactly as today) and its cost.
- [ ] **The internal-certificate route (Caddy's `tls internal`) is documented as the encrypted
      alternative** — one paragraph and one block — with its caveat stated: the certificate comes from a
      local authority no browser trusts, and iOS needs the root CA *installed* rather than a warning
      clicked through. Documented in this slice, not verified by it.
- [ ] **`AGENTS.md` §"Standing decisions"** — the auth line ("single-account login (like claudecodeui)
      over HTTPS") gains the direct route, so the standing decision stops contradicting the product.
- [ ] **Superseded pointers** on wayfinder decision 07 and its line in the wayfinder map, and on
      `spec-05-auth.md`'s "no `COOKIE_SECURE` off-switch in MVP". The map is closed and is not rewritten;
      what must not survive is a reader taking its decision for current.
- [ ] A reader who arrives at the README's auth section asking *"why is this cookie not always
      `Secure`?"* is handed the ADR (`docs/adr/0001-session-cookie-follows-public-origin.md`) rather than
      left to conclude it is an oversight.
