# 27: Serve the built SPA from the server

**What to build:** The server serves the built web client, so `npm run build && npm start` is a single deployable artifact with no Vite. `@fastify/static` serves `WEB_ROOT` at `/`, auth-exempt, with an SPA fallback to `index.html`; an unset `WEB_ROOT` changes nothing (the dev loop keeps serving the client itself). `/healthz`, `/api/**`, `/ws`, and `/ws/terminal` must still win over the static catch-all.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `server/package.json` gains `@fastify/static`; registered on `buildApp` at the root, auth-exempt (never inside the gated `/api` scope).
- [ ] `AppOptions` gains `webRoot: string | null`; `null` registers no static route (today's behavior). The "fourth and last injected seam" comment gains one line clarifying `webRoot` is configuration, not a seam.
- [ ] `ServerConfig` gains `webRoot`; `loadConfig` reads `WEB_ROOT` (trimmed), unset/blank → `null`. Env-only — no config-file fallback.
- [ ] `GET /` and `/assets/**` are served from `webRoot`; a `setNotFoundHandler` on the static scope returns `index.html` for a non-file `Accept: text/html` GET (SPA fallback).
- [ ] `/healthz`, `/api/**`, `/ws`, and `/ws/terminal` still take precedence over the static catch-all — no route is shadowed.
- [ ] `main.ts` passes `config.webRoot` through `buildApp`. `npm start` stays `node dist/main.js`.
- [ ] Tests: `static.test.ts` (builds an app with a temp `webRoot` fixture) asserts `GET /` → 200 `text/html`, an asset path → the file, a deep route → `index.html` (fallback), `/healthz` → 200, `/api/projects` → 401 unauthenticated, an unauthenticated `/ws` upgrade → still refused; `webRoot: null` → `GET /` 404s. `config.test.ts` covers `WEB_ROOT` read / blank → null / unset → null.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass.
