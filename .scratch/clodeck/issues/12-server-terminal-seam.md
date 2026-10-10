# 12: Server terminal seam — pty facade, node-pty dep, terminal manager

**What to build:** The shell that the terminal will later drive has a testable seam: node-pty sits behind a small interface so automated tests never fork a real shell, and a manager owns one shell per project with a full lifecycle — spawn on open, write, resize, kill on close, reap on exit. No route yet; this is the foundation the transport and the client hang off.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `node-pty` is a `server`-only dependency; no other package imports it.
- [ ] A `PtySpawner` interface (`spawn`) and a `PtyHandle` (`write` / `resize` / `kill` / `pause` / `resume` / `onData` / `onExit`) exist; the real impl spawns the platform shell (`powershell.exe` on Windows, `$SHELL`/`bash` on POSIX) with `cwd`, `cols`/`rows`, `TERM=xterm-256color`, and `COLORTERM=truecolor`.
- [ ] A scripted fake spawner lives in test-support (excluded from `dist`), so automated tests never fork a shell.
- [ ] A terminal manager owns one pty per project (`Map<projectId, handle>`); spawn / write / resize / kill / dispose target the right handle, and exit reaps the entry.
- [ ] Unit tests drive the manager through the fake — spawn → write → resize → kill → onExit, all asserted — with no real process.
