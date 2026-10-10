# 14: Web terminal — xterm.js panel over the raw socket

**What to build:** In the app shell, the Terminal stub becomes a real interactive xterm.js terminal bound to the selected project: keystrokes reach the shell, output (colors and cursor control) renders, resizing the panel resizes the pty, and switching projects tears the old socket down cleanly.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] A `useTerminal(project)` data seam (shaped like `useChat` / `useProjects`) owns the xterm instance and the raw socket and cleans both up on unmount.
- [ ] `TerminalPanel` replaces the Terminal stub, keyed by project id, mounting xterm.js with the attach addon on the raw `/ws/terminal` socket.
- [ ] Panel resize is wired (debounced) to the resize endpoint.
- [ ] Terminal output renders only through xterm.js — no `innerHTML`, no HTML sink for terminal bytes.
- [ ] `@xterm/xterm` and `@xterm/addon-attach` are web dependencies; typecheck and build pass.
