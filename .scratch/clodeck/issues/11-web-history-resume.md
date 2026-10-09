# 11: Web history, resume, and continue-latest

**What to build:** The client lists past sessions per project, opens a transcript, and resumes a specific session (or the latest one) into the live chat, with reload and reconnect recovery.

**Blocked by:** 09, 10

**Status:** ready-for-agent

- [ ] A session data seam lists sessions and loads a transcript via the history REST endpoints.
- [ ] A per-project session list shows past conversations with readable titles.
- [ ] Opening a session renders its transcript (complete blocks, same renderer as live).
- [ ] A resume affordance targets a specific session id (optional fork), and a "continue latest" affordance resumes the most recent session.
- [ ] Resuming sets the target for the next send rather than sending a prompt itself; the resumed turn renders in the live chat.
- [ ] A browser reload does not lose the session, and a dropped socket recovers to the current state (snapshot + reconnect).
