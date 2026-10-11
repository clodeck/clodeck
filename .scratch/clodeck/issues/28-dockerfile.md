# 28: Dockerfile — the app image

**What to build:** A multi-stage Dockerfile that packages the built app into a glibc Debian-slim image running non-root. The builder stage (`node:22`) installs and builds all three workspaces; the runtime stage (`node:22-bookworm-slim`) carries only production dependencies plus the three `dist/` trees and a working shell. The image is the input for the compose file (ticket 29).

**Blocked by:** 27 (the image is verified by the server serving `/`, which 27 makes real)

**Status:** resolved

- [x] **builder** stage from `node:22`: copy the three `package.json`s + lockfile, `npm ci`, copy source, `npm run build` (builds `shared` → `server` → `web`).
- [x] **runtime** stage from `node:22-bookworm-slim` (glibc): install a shell (`bash` — slim ships only `dash`, and node-pty spawns `$SHELL`); production dependencies only (`--omit=dev`, so no `tsx`/`vitest`/`typescript`/`vite` in the image); `shared` linked from its built `dist`, `web` not installed (static assets only).
- [x] The built `server/dist` and `web/dist` are copied into the image; `WEB_ROOT` points at the copied `web/dist`.
- [x] Non-root: runs as the image's `node` user (uid 1000), `HOME=/home/node`, `CLAUDE_CONFIG_DIR=/home/node/.claude` writable (`chown`ed).
- [x] `WORKDIR /app/server`, `EXPOSE 3001`, `CMD ["node", "dist/main.js"]`.
- [x] `.dockerignore` excludes `.git`, `node_modules`, `.scratch`, `dist`, and dev-loop scratch.
- [x] Verified by build+run: `docker build` succeeds; `docker run` with `WEB_ROOT` + a dummy `UI_PASSWORD` answers `/healthz` 200 and `/` 200 (the login screen) — recorded in the ticket's Evidence.

## What landed

```
Dockerfile         three stages: builder (node:22, full) → deps (node:22, full) → runtime
                   (node:22-bookworm-slim). Runtime carries node_modules from `deps`, the three
                   dist trees, bash, and nothing else; runs as `node`, WORKDIR /app/server.
.dockerignore      .git, .scratch, .claude, node_modules, dist, tsbuildinfo, coverage, .env*, secrets/.
```

## Decisions the spec did not pin

- **There are three stages, not two, and the third exists because of a wrong assumption in the spec.**
  The spec (and wayfinder 08 §2) says node-pty's *prebuilt binaries* load on Debian — true on macOS and
  Windows, **false on Linux**: `node-pty@1.1.0`'s tarball ships `prebuilds/{darwin-arm64,darwin-x64,win32-*}` and no `linux-x64`, so its install script falls through to `node-gyp rebuild`. A `--omit=dev`
  reinstall inside `bookworm-slim` would therefore have produced an image whose terminal panel dies on
  first connect (no `python3`, no `make`, no `g++`). The `deps` stage installs the production tree on the
  **full** image, where the toolchain is, and the runtime copies that tree — "no compiler in the shipped
  image" is preserved, and the assumption is gone rather than worked around.
- **`COPY --from=deps /app/node_modules`** rather than a third npm install: the compiled binding travels
  with the tree, and `@clodeck/shared` rides its workspace symlink to the copied `shared/dist`.
- **The workspace filter is what keeps the client toolchain out.** `web`'s React/xterm packages are
  `dependencies`, not devDependencies, so `--omit=dev` alone would have installed them into a container
  that only ever serves `web/dist` as files. `--workspace @clodeck/server` excludes that whole workspace.
- **`ENV HOST=0.0.0.0` is in the image, not only in compose.** Inside a container, the loopback default
  makes the app unreachable to anything but itself — including the image run standalone, which this
  ticket's own verification does. Compose restates it (ticket 29 pins the variable there).
- **`API` key never enters the image, and neither does the password** (`.dockerignore` also drops
  `secrets/`), which is what makes a layer leak impossible to commit by accident.

## Evidence

```
docker build -t clodeck:dev .                 → exit 0, clodeck:dev = 874 MB
docker run -d -p 18080:3001 -e UI_PASSWORD=dev -e PROJECTS_ROOT=/projects \
  -v D:/work/clodeck-projects:/projects clodeck:dev

docker exec id                                → uid=1000(node) gid=1000(node)
GET  /healthz                                 → 200 {"status":"ok"}
GET  /                                        → 200 text/html, <title>Clodeck</title> (the login screen)
GET  /projects/abc/files (Accept: text/html)  → 200 text/html (SPA fallback)
GET  /api/projects (anonymous)                → 401
POST /api/auth/login {dev}                    → 200, then /api/projects → 200 with the mounted projects
                                              (demo, hello — both from the bind-mounted host directory)
```

The terminal half, which is the part the `deps` stage exists for — node-pty imported from the image's own
`server/dist` and driving a real shell as uid 1000:

```
docker exec clodeck-test node --input-type=module -e "…createNodePtySpawner().spawn({cwd:'/projects'})…"
  → exit 0
  → "pty-ok /bin/bash GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)"
```
