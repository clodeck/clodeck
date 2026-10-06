# 02 — Per-project web terminal (PTY)

Type: research
Status: resolved

## Question

How to run an interactive per-project shell in Node and stream it to xterm.js (node-pty vs alternatives)? What isolation and security measures are needed when the shell is a full shell on the server? (Primary sources: xterm.js, node-pty, and existing projects like wetty/ttyd.)

## Answer

Use **node-pty** to spawn a real PTY in the backend and stream raw bytes to xterm.js over a **WebSocket** (`@xterm/addon-attach` contract), with **resize** added as an explicit control message (the attach addon does not send it). Skip ssh2/WebSSH2 (SSH-protocol layer, wrong for a local shell) and don't embed wetty/ttyd (standalone apps — read them only as references for security flags). Security posture = treat the terminal like an SSH daemon: WSS + session auth + origin check, run unprivileged (or node-pty `uid`/`gid`), validate/restrict `cwd` to the project dir, enforce flow control (pty pause/resume, watermark) and rlimits/cgroups, sandbox (bubblewrap/firejail/Docker) if stronger isolation is needed, and treat terminal output as untrusted (no innerHTML). Manage one pty per project via a `Map<id, IPty>` with kill-on-disconnect, caps, and idle timeouts.

Full write-up with sources: [research/02-web-terminal-pty.md](../research/02-web-terminal-pty.md)
