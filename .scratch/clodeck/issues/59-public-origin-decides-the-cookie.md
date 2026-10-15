# 59: The public origin decides the cookie

**What to build:** An operator declares the origin a browser reaches the app at — once — and the session
cookie follows it. With `CLODECK_PUBLIC_URL=http://203.0.113.10:3001`, a browser at that bare origin
keeps the session, so the app works from a phone with no tunnel and no domain. With an `https:` origin,
or with none declared, nothing changes from today. With a typo, the cookie stays `Secure` and a loud line
says so.

This is the mechanism the whole **direct route** rests on: one expression in the auth transport, and the
fail-safe contract around it. Everything else in this slice exists so the operator never has to know that
expression exists.

**Spec:** `.scratch/clodeck/spec-07-direct-route.md` (§"The public origin").

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The **public origin** comes from `CLODECK_PUBLIC_URL` (trimmed); unset or blank means *undeclared*.
      Environment-only, like the password and the web root — the config file stays `projectsRoot`-only.
- [ ] **A declared `http:` origin produces a session cookie with no `Secure`** — on login *and* on the
      clear-cookie at logout, so the two match. `HttpOnly`, `SameSite=Strict`, `Path=/` and the 7-day
      idle window are untouched.
- [ ] **A declared `https:` origin, and an undeclared one, both keep `Secure`.** An operator who upgrades
      and sets nothing sees no change at all — the undeclared case is not the insecure one.
- [ ] **A malformed value never fails open:** the cookie stays `Secure` and a warning names the variable
      and the offending value. The server still boots — refusing to start over a URL typo was considered
      and rejected, because a safe fallback plus a loud line is recoverable and a dead server is not.
- [ ] **The value is compared by scheme, never by host.** A LAN IP and a tunnelled
      `http://localhost:3001` behave exactly as any other declared origin of that scheme. Matching hosts
      would break the tunnelled and LAN-IP routes and buy nothing.
- [ ] **The WebSocket handshake check is not touched.** It still compares `Origin`'s host to the request's
      `Host` and deliberately ignores the scheme. A test pins it with the new variable declared: a
      same-origin upgrade is still admitted and a cross-origin one is still refused.
- [ ] The origin reaches the auth transport through the existing `auth` seam; `buildApp`'s `AppOptions`
      gains no field. The public origin is configuration (there is nothing behind it to fake), the same
      posture the static slice took for the web root.
- [ ] Tests assert the external contract where it already lives — the auth transport suite's login and
      logout assertions: the `Set-Cookie` header under each of the three declared states, and the
      clear-cookie on logout matching. No private helper is tested.
- [ ] `npm run typecheck` and `npm test` pass.

**Note for whoever picks this up:** ticket 60 edits the same config object and resolver neighbourhood in
the same file. Both are blocker-free and can run together, but expect one trivial conflict there.
