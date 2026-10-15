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

**Status:** resolved

- [x] A Playwright spec runs against **a non-localhost origin**: this machine's own LAN address, resolved
      at runtime. **Where no such address exists the spec skips** rather than lies.
- [x] It drives the **built client served by the server**, not the Vite dev server — so the existing
      specs on the dev pair are untouched, and the layer gains a second configuration (or project) for
      the direct route rather than a changed base URL.
- [x] The spec walks the whole acceptance path in a real browser: log in, send a turn and watch it
      stream, open the terminal and see a shell, open the file drawer and see the tree.
- [x] **The login step is the assertion the bug breaks.** With the cookie still unconditionally `Secure`,
      the browser discards it, `/api/auth/me` answers 401 and the app bounces back to the sign-in screen
      — so this spec cannot pass while the bug is present. Say that in the spec, so a later reader does
      not "simplify" the origin back to localhost.
- [x] The spec's own header names the command that puts the app up for it (the built client, the declared
      public origin, and the bind that makes it reachable), the way the existing specs state their
      prerequisites.
- [x] It is **not** part of `npm test`; it lives in the existing Playwright layer and runs with
      `npm run e2e`. The suite's existing specs still pass.
- [x] **One recorded manual run** on the direct route — the procedure and the real outcome, in this
      ticket — the same posture `npm run serve` takes in ticket 61.

## What landed

| File | What it now does |
|---|---|
| `web/e2e/direct-origin.ts` | new: the origin the direct route sits at — the machine's own non-loopback IPv4, read off `networkInterfaces()` at run time, and `PORT` (the variable the server reads, default 3001) for the port. `null` when the machine has no such address. The config and the spec both call it, so the origin they mean cannot drift |
| `web/e2e/direct-route.spec.ts` | new: the acceptance test. `test.skip` on a null origin; then sign-in, the `/api/auth/me` probe, the workspace, one chat turn watched to `Turn complete`, a shell echoing a line back off the screen, and the file drawer's tree with an uploaded row removed again |
| `web/playwright.config.ts` | two projects instead of one base URL: `dev-pair` (the five specs on `http://localhost:5173`, unchanged) and `direct-route` (`testMatch` on the one spec, `baseURL` from the resolver, a 180 s timeout for the turn). Either is selectable with `--project` |
| `web/e2e/support.ts` | `signIn` split out of `login`: the round trip on its own, so the direct spec can assert the session held *before* it waits for the workspace — which is what turns a red run into `401` rather than into a button that never came. `login` is `signIn` plus that wait, byte for byte as before |

**The assertion the bug breaks, and where it sits.** `signIn(page)` fills the box and presses Enter;
`expect.poll(… '/api/auth/me' …).toBe(200)` — the browser's own cookie jar, through the app's own gate —
is the login step, before anything the app draws. With the cookie unconditionally `Secure`, the browser
at a bare LAN origin discards it and that poll never leaves 401. The spec says so in its header, with the
"do not simplify the origin back to localhost" warning the ticket asked for: loopback is exempt from the
rule, so a localhost spec passes with the bug present and asserts nothing.

## Evidence

**The direct route, on this machine's LAN address (`172.17.0.5`), 2026-10-15.** The app was put up by
hand — tickets 60 and 61 are not on this branch, so `npm run serve` does not exist yet; what it will run
is `npm run build` then the server against the resolved web root:

```
npm run build
PORT=3300 HOST=0.0.0.0 CLODECK_PUBLIC_URL=http://172.17.0.5:3300 \
  WEB_ROOT=web/dist UI_PASSWORD=dev PROJECTS_ROOT=/tmp/clodeck-projects \
  node server/dist/main.js
  → clodeck server listening on http://0.0.0.0:3300

UI_PASSWORD=dev PORT=3300 npx playwright test --project=direct-route
  ✓  1 [direct-route] › e2e/direct-route.spec.ts:59:1 › login, chat, shell and file drawer hold at
      this machine's LAN origin (4.5s)
  1 passed (5.5s)
```

The whole path in a real browser at that origin: the login kept its session (`/api/auth/me` → 200), the
composer went live, one real turn streamed and ended on `Turn complete`, the terminal echoed
`zz-direct-route-ok` back off the pty, and the drawer's tree listed the uploaded `zz-e2e-direct.txt`
before the spec deleted it. The turn ran against this environment's own `ANTHROPIC_*` gateway, so it was
a real provider round trip and not a stub.

**The negative control — the same spec, with the bug put back.** Declared `https:` instead, so the cookie
goes back to `Secure` while the browser is still at `http://…:3300`:

```
CLODECK_PUBLIC_URL=https://172.17.0.5:3300 … node server/dist/main.js
  set-cookie: clodeck_session=…; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict

npx playwright test --project=direct-route
  Error: expect(received).toBe(expected) // Object.is equality
  Expected: 200
  Received: 401
      at web/e2e/direct-route.spec.ts:71:84   ← the /api/auth/me probe under the login
  1 failed
```

That is the ticket's claim, run rather than argued: the spec cannot pass while the bug is present, and it
fails at the login rather than somewhere downstream.

**The suite's existing specs, under the new config.** `npx playwright test --project=dev-pair` against
the dev pair (Vite on 5173, the same server behind it): **4 passed**, including `project-switch.spec.ts`,
which drives the rail and the drawer across the two-project config. One failed —
`file-download.spec.ts:48`, `expect(download.suggestedFilename()).toBe('zz-e2e-دانلود.txt')`, received
`"download"`. **The route is not at fault and is not touched here**: the header it sends is right, read
straight off the server,

```
content-disposition: attachment; filename="zz-e2e-______.txt"; filename*=UTF-8''zz-e2e-%D8%AF%D8%A7%D9%86%D9%84%D9%88%D8%AF.txt
```

so the browser in this container is what ignores the RFC 5987 name. That spec passes on the machine the
loop runs on, where Chrome is installed.

**Two things about the machine, said plainly.** This container ships no browser and
`npx playwright install chromium` returns **403** here ("not available in your location") — the failure
the config's own comment already records — so the runs above drove a Chromium 153 taken from the npm
registry (`@sparticuz/chromium`) through a **local-only** config that set `executablePath` and
`chromiumSandbox: false`. Everything else in it — the projects, the resolver, the base URL — came from
`web/playwright.config.ts`, and the override file was deleted after the runs; on a machine with Chrome,
`npm run e2e` needs no override at all. And the dev-pair specs fail if the same server process has
already run a turn on the project they drive (a replayed run state adds a second `role="status"` to the
chat, and the file specs' `getByRole('status')` then resolves to two elements) — a property of those
specs and of a shared backend, noticed here because the direct-route turn and the dev-pair specs were run
against one process; it is not something this ticket changes.

**Not run, and honestly so:** ticket 60's auto-resolved web root and ticket 61's `npm run serve` are not
on this branch, so the command in the spec's header is the *form* the app is put up in, not a command
that exists yet — the run above did the same three things by hand (`WEB_ROOT`, `HOST`, the declared
origin). Everything else in the checklist was run.
