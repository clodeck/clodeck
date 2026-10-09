# 05: Root docs + one-command dev loop

**What to build:** A root README (or AGENTS note) documents the workspace layout and the exact install/dev/build/test commands, and a single dev command boots the server watch plus the Vite dev server with its proxy so a new contributor can start iterating from a clean clone using only the documented commands.

**Blocked by:** 04

**Status:** resolved

- [x] Root README documents the three packages, the shared types package, and the install/dev/build/test commands.
- [x] A single documented dev command starts the server (watch/reload) and the web client (Vite dev server with `/api` proxy) together.
- [x] A contributor following only the documented commands can install, run, and test the workspace from a clean clone.

## What landed

```
README.md   what clodeck is, the three packages, the requirements, the five root commands, the
            configuration variables, the try-it path, and where the specs live
```

- Root `npm run dev` was already the one command (ticket 01 left it provisional, ticket 04 added the
  proxy); ticket 05 makes it the documented one. No code change was needed, so this ticket is
  docs-only — its checks are verified by *running* the documented commands against a clean clone,
  not by reading them.
- The README is explicit about the one non-obvious rule of the workspace: `dev` / `test` / `build` /
  `typecheck` build `shared` first, because `server` and `web` import it through its built `exports`
  (`shared/dist`), so editing `shared/` while `npm run dev` is running needs a `npm run build:shared`
  (or a restart). Documenting that trap beat adding a third watcher: `tsx watch` does not watch
  `node_modules`, and Vite pre-bundles its deps, so a `tsc --watch` on `shared` would *look* live
  without being live — a worse lie than a documented caveat.
- **No new test seam.** The spec's two agreed seams (the HTTP boundary, the allowlist unit) are
  already covered, and this ticket adds no public interface — only prose and an existing script.
  Verification is the clean-clone run below, in the shape ticket 04 used when the spec put
  browser-level tests out of scope.

## Evidence

The ticket's own check — a contributor following only the README — run against a fresh `git clone`
of `b45a817` in the OS temp dir (`README.md` overlaid, since it ships in this commit):

```
npm install        → 134 packages, 0 vulnerabilities
npm test           → shared 6 passed; server 15 passed | 1 skipped; web 2 passed
npm run typecheck  → clean
npm run build      → shared + server tsc clean; vite built 18 modules (index.html, 10.1 kB CSS,
                     224.7 kB JS)
npm run dev        → [web] VITE v8.3.4 ready on http://localhost:5173/
                     [server] clodeck server listening on http://127.0.0.1:3001
```

With `PROJECTS_ROOT` at a fixture root holding `alpha/`, `zulu/`, `.hidden/` and a loose file, driven
at the documented URL:

```
GET http://localhost:5173/api/projects → 200 {"projects":[alpha, zulu]}  ← real data through the Vite
                                         proxy; dotdir + loose file excluded, alphabetical
GET http://localhost:5173/             → 200 (the app shell)
GET http://127.0.0.1:3001/healthz      → 200 {"status":"ok"}
touch server/src/app.ts                → [tsx] change in ./src\app.ts Restarting...   (watch/reload)
```

Two things the run taught, deliberately left alone:

- `npm install` prints `npm warn allow-scripts … esbuild@0.28.2 (postinstall)`. That is npm 11
  declining to run install scripts unreviewed; esbuild's platform binary ships as an optional
  dependency, so the build and Vite both work — shown by the run above, not assumed.
- Vite binds `localhost` to `[::1]:5173` on this machine, so `http://127.0.0.1:5173` is refused while
  the documented `http://localhost:5173` works. The README therefore names `localhost` for the client
  and never the literal IPv4 address. The proxy's `127.0.0.1:3001` target and the server's default
  `HOST` agree, which is what the proxy needs.
