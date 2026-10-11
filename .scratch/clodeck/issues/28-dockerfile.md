# 28: Dockerfile — the app image

**What to build:** A multi-stage Dockerfile that packages the built app into a glibc Debian-slim image running non-root. The builder stage (`node:22`) installs and builds all three workspaces; the runtime stage (`node:22-bookworm-slim`) carries only production dependencies plus the three `dist/` trees and a working shell. The image is the input for the compose file (ticket 29).

**Blocked by:** 27 (the image is verified by the server serving `/`, which 27 makes real)

**Status:** ready-for-agent

- [ ] **builder** stage from `node:22`: copy the three `package.json`s + lockfile, `npm ci`, copy source, `npm run build` (builds `shared` → `server` → `web`).
- [ ] **runtime** stage from `node:22-bookworm-slim` (glibc): install a shell (`bash` — slim ships only `dash`, and node-pty spawns `$SHELL`); production dependencies only (`--omit=dev`, so no `tsx`/`vitest`/`typescript`/`vite` in the image); `shared` linked from its built `dist`, `web` not installed (static assets only).
- [ ] The built `server/dist` and `web/dist` are copied into the image; `WEB_ROOT` points at the copied `web/dist`.
- [ ] Non-root: runs as the image's `node` user (uid 1000), `HOME=/home/node`, `CLAUDE_CONFIG_DIR=/home/node/.claude` writable (`chown`ed).
- [ ] `WORKDIR /app/server`, `EXPOSE 3001`, `CMD ["node", "dist/main.js"]`.
- [ ] `.dockerignore` excludes `.git`, `node_modules`, `.scratch`, `dist`, and dev-loop scratch.
- [ ] Verified by build+run: `docker build` succeeds; `docker run` with `WEB_ROOT` + a dummy `UI_PASSWORD` answers `/healthz` 200 and `/` 200 (the login screen) — recorded in the ticket's Evidence.
