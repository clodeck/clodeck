# 05: Root docs + one-command dev loop

**What to build:** A root README (or AGENTS note) documents the workspace layout and the exact install/dev/build/test commands, and a single dev command boots the server watch plus the Vite dev server with its proxy so a new contributor can start iterating from a clean clone using only the documented commands.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Root README documents the three packages, the shared types package, and the install/dev/build/test commands.
- [ ] A single documented dev command starts the server (watch/reload) and the web client (Vite dev server with `/api` proxy) together.
- [ ] A contributor following only the documented commands can install, run, and test the workspace from a clean clone.
