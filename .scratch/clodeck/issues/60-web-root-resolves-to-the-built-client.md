# 60: The web root resolves to the built client

**What to build:** With `WEB_ROOT` unset and a build present, `GET /` is the app rather than a 404 — the
second of the two walls the operator hit. An unset root with **no** build present changes nothing: the
Vite dev loop serves the client itself, exactly as today. Either way the server logs which directory it
picked, or that it picked none and why. The silent 404 was as much the bug as the missing default.

**Spec:** `.scratch/clodeck/spec-07-direct-route.md` (§"The web root").

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `WEB_ROOT` unset → the resolver walks up from the working directory to the directory whose package
      manifest declares workspaces, and uses `web/dist` there when it exists.
- [ ] `WEB_ROOT` unset and no such build → nothing is served: today's behaviour, byte for byte. The Vite
      dev loop does not go near any of this.
- [ ] **`WEB_ROOT` explicitly set still wins**, unchanged.
- [ ] **The resolver takes its starting directory as an argument.** A test of path resolution must not
      depend on this machine's own build output — that is the one thing such a test must never do.
- [ ] **The resolution is logged either way:** the directory that was picked, or that none was and why.
      "`GET /` is a 404" becomes answerable from the log instead of mysterious.
- [ ] Serving the built client is observable end to end: with a resolved root, `GET /` returns the app
      shell, a deep client route falls back to it, and an asset path returns the file. `/healthz`,
      `/api/**`, `/ws` and `/ws/terminal` still win over the static catch-all — no route is shadowed.
- [ ] Tests extend the existing static suite: an auto-resolved root against fixture directories, an unset
      root with no build → 404, and an explicit `WEB_ROOT` → today's behaviour. The suite's existing SPA
      fallback and gate-over-catch-all cases must still hold.
- [ ] The resolver is tested directly against fixture directories, as a pure function.
- [ ] `npm run typecheck` and `npm test` pass.

**Note for whoever picks this up:** ticket 59 edits the same config object in the same file. Both are
blocker-free and can run together, but expect one trivial conflict there.
