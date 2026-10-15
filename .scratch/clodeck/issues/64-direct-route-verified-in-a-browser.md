# 64: The direct route, verified in a browser

**What to build:** The acceptance test for the whole slice — and the only one that could have caught the
bug it fixes. A real browser, at a **non-loopback origin**, driving login → chat → terminal → file drawer
against the **built client served by the server**.

The origin is the point, not the browser: loopback is exempt from the `Secure` rule, so the Playwright
layer's existing base URL passes *with the bug present*. A spec that runs on `localhost` proves nothing
here.

**Spec:** `.scratch/clodeck/spec-07-direct-route.md` (§"Verification"). Establishes decision 15.

**Blocked by:** 59 (the cookie follows the declared origin), 60 (the web root resolves), 61 (one command
puts the app up)

**Status:** ready-for-agent

- [ ] A Playwright spec runs against **a non-localhost origin**: this machine's own LAN address, resolved
      at runtime. **Where no such address exists the spec skips** rather than lies.
- [ ] It drives the **built client served by the server**, not the Vite dev server — so the existing
      specs on the dev pair are untouched, and the layer gains a second configuration (or project) for
      the direct route rather than a changed base URL.
- [ ] The spec walks the whole acceptance path in a real browser: log in, send a turn and watch it
      stream, open the terminal and see a shell, open the file drawer and see the tree.
- [ ] **The login step is the assertion the bug breaks.** With the cookie still unconditionally `Secure`,
      the browser discards it, `/api/auth/me` answers 401 and the app bounces back to the sign-in screen
      — so this spec cannot pass while the bug is present. Say that in the spec, so a later reader does
      not "simplify" the origin back to localhost.
- [ ] The spec's own header names the command that puts the app up for it (the built client, the declared
      public origin, and the bind that makes it reachable), the way the existing specs state their
      prerequisites.
- [ ] It is **not** part of `npm test`; it lives in the existing Playwright layer and runs with
      `npm run e2e`. The suite's existing specs still pass.
- [ ] **One recorded manual run** on the direct route — the procedure and the real outcome, in this
      ticket — the same posture `npm run serve` takes in ticket 61.
