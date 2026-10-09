# 08 — Docker image specifics

Type: grilling
Status: resolved
Blocked by: 02, 05, 06, 07

## Question

How do we package the app for the Docker deploy? Specifically: (a) topology — app container + Caddy reverse-proxy sidecar (docker-compose) vs a single combined image vs app-only; (b) base image and native-module handling — Debian-slim (glibc) vs Alpine (musl), given node-pty and the SDK's bundled native binary; (c) volumes and in-container config — how `~/.claude` and `PROJECTS_ROOT` mount, and how the API key and password reach the container; (d) build layout and runtime hardening — multi-stage build, non-root user, init/signal handling, healthcheck.

## Answer

**Verdict: a two-service docker-compose — the app container plus a Caddy reverse-proxy sidecar — built multi-stage from `node:22-bookworm-slim` (glibc), running non-root under tini, with `~/.claude` on a named volume and `PROJECTS_ROOT` bind-mounted from the host.** The app image is also usable standalone (user-supplied proxy), since 07 already made TLS termination a config choice.

### 1. Topology

- **App + Caddy sidecar** in a `docker-compose.yml`. Caddy terminates TLS with automatic Let's Encrypt certs (07) and reverse-proxies to the app; the app sits on the compose-internal network only and is never published to the host.
- **The app image stands alone too** — build it so it can run without the sidecar (direct TLS via a cert path, 07 §2), for users who already have a proxy. The compose file is the *default* deployment, not the only one.
- **Rejected:** a single combined image (app + Caddy in one container) — two processes under one PID-1 is an init problem for no benefit.

### 2. Base image & native modules

- **`node:22-bookworm-slim` (glibc).** node-pty's prebuilt binaries and the SDK's bundled native Claude Code binary are glibc — they work out of the box on Debian-slim. Alpine (musl) would force a node-pty rebuild (`python3`/`make`/`g++`) and a libc-compat shim for the SDK binary, for a size saving that doesn't matter on a single-server deploy. Multi-stage + Debian-slim is small enough.

### 3. Volumes & config

- **`~/.claude` → named volume** (isolated), via `CLAUDE_CONFIG_DIR` pointing into it. Not a bind-mount of the host's `~/.claude` — that would mix the container's transcript store with the host user's own Claude Code state.
- **`PROJECTS_ROOT` → bind mount** (host path → `/projects`). This is the user's real code; it must be a host directory.
- **Secrets via env/secret-file:** `ANTHROPIC_API_KEY`, `UI_PASSWORD` (or `UI_PASSWORD_FILE`, the Docker-secret pattern from 07). Remaining config (`PROJECTS_ROOT`, `CLAUDE_CONFIG_DIR`, cert path) also via env, matching 05's env-var-primary stance.

### 4. Build & runtime hardening

- **Multi-stage:** a builder stage (full `node:22`, install deps, `tsc` the backend, `vite build` the frontend) → a runtime stage (`node:22-bookworm-slim`, only `dist` + production deps).
- **Non-root runtime** — mandated by 02 (node-pty: "all processes launched from node-pty will launch at the same permission level of the parent process"). Run as a dedicated unprivileged user with a writable `HOME` (for the `~/.claude` volume).
- **`init: true` (tini)** so Node receives SIGTERM and shuts down gracefully (interrupt in-flight turns, kill terminals).
- **`GET /healthz`** (auth-exempt) for Docker/Caddy health checks.

Backing: [02 — Web terminal (PTY)](02-web-terminal-pty.md) (node-pty non-root/container), [05 — Project discovery](05-project-discovery.md) (`PROJECTS_ROOT` env), [06 — Session ↔ Project data model](06-session-project-data-model.md) (`~/.claude` volume), [07 — Auth & Permissions](07-auth-permissions.md) (Caddy reverse proxy, `UI_PASSWORD`).
