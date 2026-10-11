# 30: Deploy docs + end-to-end verification

**What to build:** The README "Deploy" section that turns the compose file into a documented contract — the env vars, the secret-file shape, the Let's Encrypt requirement, and the happy path — plus the end-to-end verification that the whole slice actually serves a user over HTTPS.

**Blocked by:** 29 (the docs describe the running compose, and the verification runs it)

**Status:** ready-for-agent

- [ ] README gains a "Deploy" section: the env contract (`CLODECK_DOMAIN`, `ANTHROPIC_API_KEY`, `UI_PASSWORD_FILE`, `PROJECTS_ROOT`), the secret-file shape, the Let's Encrypt requirement (a reachable domain + ports 80/443), and the `docker compose up -d` happy path.
- [ ] README notes `WEB_ROOT` in the configuration table (env-only, the server serves the SPA when set; the dev loop stays on Vite).
- [ ] The handoff's "server does not serve the built client yet" note and the corresponding README line are corrected — the server now serves the built client when `WEB_ROOT` is set.
- [ ] End-to-end verification recorded in Evidence: `docker compose up -d`, `curl https://<domain>/healthz` → 200, a login through HTTPS sets the `Secure` cookie, a project from the bind-mounted `PROJECTS_ROOT` is visible — the same by-hand posture as the auth slice's evidence.
