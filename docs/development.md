# Development

## Commands

Every command runs from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces and wires the pre-commit hook. `npm ci` for a deployment. |
| `npm run dev` | Builds `shared`, then runs the server (`tsx watch` — reloads on change) and the web client (Vite dev server) together. Reads no file: every variable comes from the shell it is run in. |
| `npm run dev:env` | The same loop with `.env` loaded first. Names the keys it loaded, never their values, and stops plainly when there is no `.env`. `npm run dev:env -- <script>` loads it for any other script instead. |
| `npm run dev:fake` | The same, but the server runs a scripted fake Agent SDK provider instead of the real one — the whole chat surface with no API key and no network. It still needs `UI_PASSWORD`: the gate is installed the same way. |
| `npm run dev:fake:env` | `npm run dev:fake` with `.env` loaded first. |
| `npm run build` | Builds `shared` → `server` → `web` into each package's `dist/`. |
| `npm run serve` | **The deployment command:** a preflight that stops — plainly, before anything is built — when `UI_PASSWORD` or `PROJECTS_ROOT` is missing, then `npm run build`, then the server, serving the client it just built. |
| `npm test` | Builds `shared`, then runs the whole Vitest suite across all packages. |
| `npm run typecheck` | Type-checks every package (`tsc` with `noEmit` — nothing is written). |
| `npm run e2e` | Runs the Playwright suite in `web/e2e/` against an app that is already up (see [End-to-end](#end-to-end)). |
| `bash scripts/setup-clodeck.sh` | Walks you through the configuration — projects root, password, provider profiles — then writes `.env` and a launcher for `npm run serve`. |
| `bash scripts/deploy-clodeck.sh` | The same walk for a Linux **server**: prerequisites, `/etc/clodeck/clodeck.env`, the login password file, a systemd unit, the firewall, and a `/healthz` wait. |
| `npm start --workspace @clodeck/server` | Runs the server from `dist/`, serving the client directory it resolves (or the `WEB_ROOT` you set). |

`dev`, `test`, `build` and `typecheck` all build `shared` first, because `server` and `web` resolve it
through its built `exports` (`shared/dist`) — a clean clone has nothing to import until that happens.
For the same reason, editing `shared/` while `npm run dev` is running needs a `npm run build:shared`
(or a restart) before the server and the client see the change.

## The pre-commit hook is the fastest check, not the only one

`npm install` wires `.githooks/pre-commit` through `core.hooksPath`. It runs:

```sh
node scripts/tickets.mjs check   # the local tracker's own consistency rule
npm run typecheck
npm test
```

so a red tree is never committed. `git commit --no-verify` skips all three once. If the hook never
seems to fire, `git config core.hooksPath` should answer `.githooks`; `npm run prepare` sets it. CI
runs the same list — plus `npm run build` — on every push to `main` and every PR to `master`
(see [CI/CD](ci-cd.md)).

## Two traps are load-bearing

Both are commented where they live, so the next person does not "fix" them back:

- **`npm run dev` passes `--raw` to `concurrently` on purpose.** Without it, `concurrently`'s
  line-prefixing streams deadlock the real Agent SDK's import under `tsx watch`: the server starts,
  prints nothing, never listens, and the client's proxy answers 502. `dev:fake` never imports the SDK,
  so it keeps the prefixes.
- **The Playwright config drives the machine's installed Chrome** (`channel: 'chrome'`), because
  `npx playwright install chromium` can fail behind a restrictive network with
  `Failed to download Chrome for Testing`. In CI the same config leaves `channel` off and drives the
  Chromium the nightly job installs; `CI` is the switch.

## End-to-end

End-to-end tests need a running app and a browser, which is why they are not part of `npm test`:

```sh
UI_PASSWORD=dev PROJECTS_ROOT=~/clodeck-projects PORT=3300 npm run dev   # one shell
UI_PASSWORD=dev npm run e2e                                              # another
```

The dev server must be on <http://localhost:5173>, and the server must be hashed against the same
`UI_PASSWORD` the suite sends, because it logs in like a person does. The suite's `direct-route`
project is the exception: it drives the **built client served by the server** at a non-loopback
address — loopback is exempt from the browser's `Secure` rule, so a spec there would assert nothing —
and that spec's header names the command that puts the app up for it. In CI, the nightly
[E2E workflow](ci-cd.md#the-checks) runs the `dev-pair` project only.

## Repository automation

- `npm run pr` pushes `main` and opens the pull request that publishes production. See
  [CI/CD](ci-cd.md).
- `npm run sandcastle` drains the ticket queue under `.scratch/clodeck/issues/` — one pass per ticket,
  each on its own branch in its own container. It never merges and never pushes.
- Conventions — branch naming, commit style, what lands where — are in [`AGENTS.md`](../AGENTS.md).
