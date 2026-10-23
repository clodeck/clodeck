# syntax=docker/dockerfile:1

# Clodeck in an image (spec-06 §28). Three stages, because the two halves need
# opposite things: compiling the three workspaces needs the full toolchain, and
# running the result must not have one. Everything is Debian — glibc — because
# the SDK ships a native `claude` binary and node-pty links against the C
# library; Alpine would mean a rebuild and a compatibility shim for neither
# benefit (wayfinder 08 §2).

# ---------------------------------------------------------------------------
# builder — compile shared, server and web
# ---------------------------------------------------------------------------
# The full image, not slim: it has the toolchain `npm run build` needs (tsc for
# three packages, Vite for the client) and is thrown away at the end.
FROM node:22 AS builder
WORKDIR /app

# Which commit this image is built from (ADR 0004). The build context excludes
# `.git`, so without the argument the artifact honestly stamps itself `unknown`:
# pass `--build-arg CLODECK_BUILD_COMMIT=$(git rev-parse HEAD)` to name it.
# `ENV` is what `npm run build`'s stamp step reads, and it stays in this stage —
# the shipped image carries the stamp in `server/dist`, not in its environment.
ARG CLODECK_BUILD_COMMIT
ENV CLODECK_BUILD_COMMIT=${CLODECK_BUILD_COMMIT}

# Manifests first: `npm ci` reads nothing else, so editing a source file does
# not re-resolve the dependency graph.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

# The sources, and the tsconfig the packages extend. `node_modules` and `dist`
# are not in the build context at all (see .dockerignore), so these copies carry
# only what compiles.
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build

# ---------------------------------------------------------------------------
# deps — the production dependency tree, installed where a compiler exists
# ---------------------------------------------------------------------------
# node-pty's tarball ships prebuilds for macOS and Windows only; on Linux its
# install script falls through to `node-gyp rebuild`, so the tree must be
# installed on an image that has python3/make/g++ — this one. The runtime copies
# this tree instead of installing anything, which is what keeps a compiler (and
# tsx, vitest, typescript and vite) out of the shipped image.
FROM node:22 AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# The workspace filter is the other half of "no client toolchain in the image":
# `web` ships as static files, so its React/xterm dependencies are never
# installed. `shared` arrives as a workspace link to its own `dist`.
RUN npm ci --omit=dev --workspace @clodeck/server

# ---------------------------------------------------------------------------
# runtime — the artifact: production deps, three dists, a shell
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# slim carries `dash` and nothing else, and the terminal panel spawns a login
# shell — `platformShell` falls back to `bash` when `$SHELL` is unset.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash \
 && rm -rf /var/lib/apt/lists/*

# The deploy contract, as defaults the compose file restates. `HOST=0.0.0.0`
# because loopback inside a container reaches nobody — Caddy connects to this
# process over the compose network, not over the container's own loopback.
ENV NODE_ENV=production \
    HOME=/home/node \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    WEB_ROOT=/app/web/dist \
    PORT=3001 \
    HOST=0.0.0.0

WORKDIR /app
COPY --from=deps /app/node_modules node_modules/
COPY --from=builder /app/shared/package.json shared/package.json
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/server/package.json server/package.json
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/web/dist web/dist

# The transcript store's mount point, created *before* the volume exists so the
# named volume inherits `node`'s ownership: a root-owned ~/.claude would leave
# the SDK unable to write a transcript, and the failure would look like a chat
# bug rather than a permissions one.
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node

USER node
WORKDIR /app/server
EXPOSE 3001

# No `sh -c`: compose runs this with `init: true`, so node is not PID 1 and a
# SIGTERM reaches it as a signal rather than as a shell's exit code.
CMD ["node", "dist/main.js"]
