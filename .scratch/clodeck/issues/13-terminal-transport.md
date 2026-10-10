# 13: Terminal transport — raw-byte `/ws/terminal` and resize REST

**What to build:** A browser can open a raw WebSocket to the selected project's terminal, type into it and see bytes stream back, and resize the pty by posting a size. The project id is re-validated through the allowlist before any process spawns, so a non-allowlisted id is refused, never opened.

**Blocked by:** 12

**Status:** ready-for-agent

- [ ] `/ws/terminal?projectId=…` is registered on the same Fastify instance `buildApp` returns (raw bytes, no JSON).
- [ ] The project id is resolved through the allowlist seam; a non-allowlisted id closes the socket before any pty spawns.
- [ ] On connect a pty spawns at the project's canonical `cwd`; bytes client→server reach the pty; pty output streams to the socket; closing the socket kills the pty and cleans it up.
- [ ] `POST /api/projects/:id/terminal/size` resizes the project's current pty (`200`), answers `404` when there is no terminal, and `400` on a malformed body.
- [ ] End-to-end tests drive the raw socket and the resize endpoint against the fake spawner (no real shell).
