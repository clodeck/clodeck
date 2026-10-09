# 07 — Auth & Permissions

Type: grilling
Status: resolved
Blocked by: 04, 05, 06

## Question

How do we authenticate the single user to the web UI and protect every endpoint behind it? Specifically: (a) session mechanism — httpOnly cookie vs JWT/bearer token — given the chat and terminal WebSockets must also be authenticated; (b) HTTPS termination — reverse proxy vs the Node server itself; (c) credential form and storage — password-only vs username+password, and plaintext-env vs a bcrypt/argon2 hash; (d) the authorization boundary — what is protected, and does the middleware resolve a per-user principal now (the multi-user seam) or stay binary?

## Answer

**Verdict: single-account login over HTTPS via an httpOnly session cookie, backed by an in-memory server-side session store; the single password is supplied as `UI_PASSWORD` (or `UI_PASSWORD_FILE`) and held only as a bcrypt/argon2 hash.** Everything (`/api/**`, `/ws**`) is gated behind principal-aware middleware that resolves a fixed `"default"` principal — binary in practice today, the attach-point for per-user scoping later. TLS terminates at a reverse proxy (Caddy) by default; the app can also terminate TLS directly when given a cert path.

### 1. Session mechanism

- **httpOnly session cookie** (server-side session), not a JWT/bearer token. The browser cannot set `Authorization` headers on WebSocket upgrades, but it *does* send cookies same-origin — so both the chat bus (`/ws`) and the terminal socket (`/ws/terminals/:id`) authenticate with the same cookie, with no token in the query string (which would leak into access logs).
- Cookie flags: **httpOnly** (no JS access → anti-XSS), **Secure** (HTTPS only), **SameSite=Strict** (anti-CSRF), `Path=/`, plus the **origin check** already required by 02 on WS upgrades.
- **Rejected:** JWT/bearer in localStorage (WS auth needs a query-string token or subprotocol — leaks), and opaque header tokens (same WS problem).

### 2. HTTPS termination

- **Reverse proxy (Caddy/Nginx) terminates TLS by default** — Caddy gives automatic Let's Encrypt certs, the simplest path for a Docker deploy. The app serves plain HTTP behind it.
- **The app also supports direct TLS** (`https.createServer` with a cert/key path from config) for deployments without a proxy. Default is proxy; direct TLS is a config fallback, so "single-account login over HTTPS" (AGENTS.md) holds either way.

### 3. Credential

- **Password-only, single implicit account.** `POST /api/auth/login` body is `{ "password": "…" }`. No username in MVP (adding one later is trivial).
- **Source:** `UI_PASSWORD` env var, or `UI_PASSWORD_FILE` (Docker-secret pattern) for a mounted secret.
- **Storage:** the server hashes the password with bcrypt/argon2 at startup and does a **timing-safe compare** on login. The plaintext exists only in the env/secret; it is never written at rest to a config file.

### 4. Authorization boundary (and the multi-user seam)

- **Principal-aware, binary in practice.** Middleware resolves a fixed principal (`{ id: "default", name: "default" }`) on every authenticated request. Today there is no per-user ACL — the check is "authenticated or not".
- **Everything is gated:** `/api/**` and `/ws**` require a valid session; the SPA's static bundle is public (JS/CSS carries no secrets), and the client shows a login screen on 401.
- **The seam:** the same `principal` is what later per-user scoping consumes — it flows into project discovery (05) and the session store (06), so multi-user becomes "parameterize with an actor", not a rewrite (05 §7).

### 5. Session store

- **In-memory store, behind a small interface** (`get`/`set`/`del`). A server restart invalidates all sessions → the single user re-logs-in, which is acceptable for MVP.
- The interface (not a raw `Map` leaked across the codebase) is the swap point for Redis/DB when multi-instance or multi-user arrives — the same seam as 05/06.

### 6. Session lifetime

- **Sliding 7-day idle.** Cookie `Max-Age` = 7 days, refreshed (touched) on every authenticated request including WS traffic. Active users never hit it; idle > 7 days logs out. The exact duration is a tunable, not a structural decision.

### 7. Login brute-force protection

- **Per-IP rate limit** (e.g. 5 failed attempts / 15 min) and a **short lockout** (15 min) after 5 failures, with every failed login logged. Combined with the timing-safe compare from §3, this is sufficient for a single-user tool — no CAPTCHA or extra complexity in MVP.

### 8. CSRF, static assets, logout, `/me`

- **CSRF:** `SameSite=Strict` + `Content-Type: application/json` only + same-origin (no CORS) → **no CSRF token in MVP.** CSRF needs a form-style POST or an open CORS policy to matter; this app has neither.
- **Static assets:** the SPA bundle is public; `/api/**` and `/ws**` are gated; the client renders a login screen on 401.
- **Logout:** `POST /api/auth/logout` destroys the server-side session and clears the cookie.
- **`GET /api/auth/me`:** returns `{ "principal": { "id": "default", "name": "default" } }` (200) or 401.

Backing: [04 — Backend transport and API shape](04-backend-transport.md) (auth REST endpoints, WS endpoints), [02 — Web terminal (PTY)](02-web-terminal-pty.md) (WS origin check), [05 — Project discovery](05-project-discovery.md) and [06 — Session ↔ Project data model](06-session-project-data-model.md) (multi-user seam).
