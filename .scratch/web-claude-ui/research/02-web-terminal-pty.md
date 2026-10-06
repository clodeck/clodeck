# 02 — Per-project web terminal (PTY): research

Question: how to run an interactive per-project shell in Node and stream it to xterm.js
(node-pty vs alternatives), what isolation/security measures are needed for a full
server-side shell exposed to the browser behind a login, and what is the standard
protocol between the PTY and the frontend.

## TL;DR / recommendation

Use **node-pty** to spawn a real PTY in the backend, stream raw bytes to
**xterm.js** over a **WebSocket** (the `@xterm/addon-attach` contract), and add
**resize** as an explicit control message. Do **not** use ssh2/WebSSH2 (they are for
speaking the SSH protocol to an SSH server, which is the wrong layer when the shell is
local to your own backend), and do not embed wetty/ttyd (they are standalone apps, not
libraries). Treat the terminal with the same posture as an SSH daemon: run the backend
unprivileged (or drop `uid`/`gid`), restrict `cwd` to the project directory, enforce
flow control, and consider a container/sandbox.

---

## 1. Recommended library: node-pty (and why not the alternatives)

### node-pty — the right choice

`node-pty` is "`forkpty(3)` bindings for node.js" — it forks a process with a
pseudoterminal file descriptor and returns a terminal object you can read from and
write to
([microsoft/node-pty README](https://github.com/microsoft/node-pty)). This is exactly
the "spawn a local shell and stream it" primitive, and it is the library the official
xterm.js demo uses (`pty.spawn('bash' | 'powershell.exe', [], {...})` in
[demo/server/server.ts](https://raw.githubusercontent.com/xtermjs/xterm.js/master/demo/server/server.ts)).

Core API (from
[typings/node-pty.d.ts](https://raw.githubusercontent.com/microsoft/node-pty/main/typings/node-pty.d.ts)):

```ts
spawn(file, args, options): IPty   // options: name, cols, rows, cwd, env, encoding,
                                   //   handleFlowControl, flowControlPause/Resume,
                                   //   uid?, gid? (Unix), useConpty? (Windows)

interface IPty {
  readonly pid: number;
  readonly cols: number; readonly rows: number; readonly process: string;
  handleFlowControl: boolean;
  readonly onData: IEvent<string>;                     // child stdout
  readonly onExit: IEvent<{ exitCode: number; signal?: number }>;
  resize(columns: number, rows: number, pixelSize?: { width; height }): void;
  clear(): void;
  write(data: string | Buffer): void;
  kill(signal?: string): void;
  pause(): void; resume(): void;
}
```

Notes that matter for this project:

- **Platforms:** Linux, macOS, Windows. Windows uses the ConPTY API and requires
  Windows 10 build 1809 (18309)+; the legacy winpty path is removed
  ([README](https://github.com/microsoft/node-pty)). Our server is Linux/Docker, so
  this is a non-issue, but it means the same code path is portable if we ever run the
  backend on Windows.
- **Runtime requirement:** Node.js 16+ (README).
- **`cwd` per spawn** — every pty can be pointed at a different project directory, which
  is exactly the "one shell per project" model.
- **`uid`/`gid` (Unix)** — can drop privileges per spawned shell, useful for isolation.
- **`encoding: null`** gives raw binary output (required for full TUI fidelity and
  matches xterm.js's binary mode in the demo).

### Alternatives — and why they don't fit

| Option | What it is | Verdict for this project |
|---|---|---|
| **node-pty** | Direct pty binding (`forkpty`); local process | **Use this.** Local shell, no sshd, full `cwd`/`env`/`uid` control. |
| **ssh2** ([mscdex/ssh2](https://github.com/mscdex/ssh2)) | Pure-JS SSH **client/server** library | Wrong layer: it connects over the SSH protocol to an SSH server. Adds an sshd dependency for a shell that is already local. Useful only if we ever proxy to remote hosts. |
| **WebSSH2** ([billchurch/WebSSH2](https://github.com/billchurch/WebSSH2)) | Full app: ssh2 + xterm.js + socket.io + express | SSH-proxy app, not a library. Its security model (host-key verification, CIDR subnet restrictions) is about remote SSH targets — irrelevant to a local per-project shell. |
| **wetty** ([butlerx/wetty](https://github.com/butlerx/wetty)) | Full app: **node-pty** + xterm.js + socket.io (confirmed in [package.json](https://raw.githubusercontent.com/butlerx/wetty/master/package.json)) | Same pty primitive as us, but it's a standalone server, not an embeddable library. Good *reference* for flags (`--allowed-origin`, auth). Note its default non-root mode shells out to `ssh localhost` (i.e. needs sshd); when run as root it launches `/bin/login`. We want neither. |
| **ttyd** ([tsl0922/ttyd](https://github.com/tsl0922/ttyd)) | Standalone **C** binary (libuv + libwebsockets + xterm.js) | Can't be embedded in a Node/TS backend. Best *reference* for security flags: `-O --check-origin`, `-u/-g` uid/gid, `-w` cwd, `-W --writable` (read-only by default), `-c` basic auth, `-m --max-clients`. |

**Conclusion:** node-pty is the library; wetty and ttyd are read as reference
implementations for security flags and protocol choices, and ssh2/WebSSH2 are the
"remote SSH" path we are deliberately *not* taking.

---

## 2. The WebSocket / attach protocol between PTY and frontend

### Client contract: `@xterm/addon-attach`

The attach addon defines the minimal contract. From
[AttachAddon.ts](https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-attach/src/AttachAddon.ts)
(current master):

- Constructor sets `socket.binaryType = 'arraybuffer'`.
- `socket.onmessage` → `terminal.write(data)` (accepts `string` or `Uint8Array`).
- `terminal.onData(data)` → `socket.send(data)` (text input, raw).
- `terminal.onBinary(data)` → `socket.send(new Uint8Array(...))` (binary input, bytes
  truncated `& 255`).
- `close`/`error` → `dispose()`.
- **The addon does not handle resize** — no `open` listener, no `terminal.onResize`
  listener, no resize message. The app must wire `terminal.onResize` itself and send the
  size out-of-band.

The install/usage pattern
([addon-attach README](https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-attach/README.md),
[Using addons](https://xtermjs.org/docs/guides/using-addons/)):

```ts
import { Terminal } from '@xterm/xterm';
import { AttachAddon } from '@xterm/addon-attach';
const term = new Terminal();
term.loadAddon(new AttachAddon(webSocket));
```

So the *standard* data channel is a **raw bidirectional byte stream over one
WebSocket**: input = raw bytes client→server, output = raw bytes server→client.

### Server contract: the official xterm.js demo (node-pty + ws/express-ws)

The canonical reference implementation
([demo/server/server.ts](https://raw.githubusercontent.com/xtermjs/xterm.js/master/demo/server/server.ts),
and the older `ws`-based
[demo/server.js @5.0.0](https://raw.githubusercontent.com/xtermjs/xterm.js/5.0.0/demo/server.js)):

- Spawn: `pty.spawn(isWindows ? 'powershell.exe' : 'bash', [], { name:'xterm-256color', cols, rows, cwd, env (COLORTERM='truecolor'), encoding: USE_BINARY ? null : 'utf8', useConpty })`.
- Buffer pty output before the WebSocket attaches (`unsentOutput[pid] += data`), then
  flush it on connect so nothing is lost during the HTTP→WS handoff.
- `pty.onData(data => ws.send(data))` — with a small batching buffer (3 ms / 256 KB
  chunk cap) to avoid a send per byte.
- `ws.on('message', msg => pty.write(msg))` — **every WS message is raw input**, no JSON
  parsing on the data channel.
- **Resize is a separate HTTP endpoint**, not a WS message:
  `POST /terminals/:pid/size?cols=&rows=&pixelWidth=&pixelHeight=` → `pty.resize(cols, rows, {width, height})`.
  The client wires it in `terminal.onResize`
  ([demo/client/client.ts](https://raw.githubusercontent.com/xtermjs/xterm.js/master/demo/client/client.ts)).
- `ws.on('close')` → `pty.kill()` and delete from the `terminals` map.

### Production variant: single-socket framed protocol (ttyd)

ttyd keeps everything on one socket using a **leading command byte** framing
([html/src/components/terminal/xterm/index.ts](https://raw.githubusercontent.com/tsl0922/ttyd/main/html/src/components/terminal/xterm/index.ts)):

- Client→server: command byte `'0'` = INPUT (raw bytes after), `'1'` = RESIZE
  (`JSON.stringify({ columns, rows })` after the byte), `'2'`/`'3'` = PAUSE/RESUME
  (flow control).
- Server→client: command byte `'0'` = OUTPUT (raw bytes after) → `terminal.write`.

### Recommendation for this project

Mirror the xterm.js demo (raw I/O over the WebSocket) and add **resize** as an explicit
control signal. Two clean options:

1. **Two-channel (simplest, matches official demo):** raw bytes on the WS for I/O; a
   small authenticated `POST /terminals/:id/size` for resize. Downside: resize isn't
   atomic with the socket and needs its own CSRF/auth handling.
2. **Framed single-socket (ttyd-style):** prefix control frames with a reserved byte or
   wrap resize in a JSON message and detect it server-side before `pty.write`. Cleaner
   lifecycle (one connection owns the terminal) at the cost of a tiny framing layer.

Either is standard; do **not** rely on the attach addon to send resize — it does not.

---

## 3. Security and isolation

A full shell on the server, reachable through the browser, is effectively **remote code
execution for anyone who authenticates**. Posture: treat the terminal endpoint like an
SSH daemon, even though it's single-user behind a login.

### Transport & auth

- **WSS only** ("use secure transport (wss)"), and "additional protocols on top of
  websocket messages to provide appropriate authorization/authentication"
  ([xterm.js Security guide](https://xtermjs.org/docs/guides/security/)).
- Session cookie/token from the existing login; the WebSocket (and any resize HTTP
  endpoint) must authenticate the same session — not just the initial page load.
- **Origin check** on the WS handshake to block cross-site WebSocket hijacking —
  ttyd's `--check-origin` and wetty's `--allowed-origin` are the reference flags.
- CSRF protection on the resize/terminals endpoints (they mutate server state).
- Rate-limit/lockout the login, since a breached login = a shell.

### Privilege

- **node-pty's own warning:** "All processes launched from node-pty will launch at the
  same permission level of the parent process" and it recommends running the PTY in a
  container when exposed to the internet
  ([node-pty README](https://github.com/microsoft/node-pty)).
- Never run the backend as root. Run it as a dedicated unprivileged OS user, and/or use
  node-pty's Unix `uid`/`gid` spawn options to drop to a per-project identity.
- Run the whole backend in a container (the repo already targets Docker deploy).

### cwd restriction (per-project)

- Spawn with `cwd = <project dir>`, but **validate** the path first: resolve it and
  check it is a real directory inside the configured project root (reject `..`, symlink
  escapes, absolute paths outside the root). The cwd is the project boundary, not the
  shell boundary — a shell can still `cd ..`, so cwd is *convenience*, not *sandboxing*.

### Sandboxing (real isolation)

- cwd is not a sandbox. For stronger guarantees, run each terminal in a
  **bubblewrap/firejail/Docker** container (or a `chroot`) per project, or at minimum
  confine the whole backend container. ttyd's `-u/-g` (uid/gid) and `-w` (cwd) flags and
  node-pty's `uid`/`gid` options are the per-process controls available without a full
  sandbox.
- If SSH-to-remote ever becomes a feature, WebSSH2's model is the reference:
  trust-on-first-use host-key verification and CIDR subnet restrictions
  ([WebSSH2 README](https://github.com/billchurch/WebSSH2)).

### Resource limits & flow control

- **Output flood protection.** xterm.js `write` is non-blocking and buffers; its input
  buffer has a hard ~50 MB cap and **discards** data beyond it, and throughput is
  5–35 MB/s
  ([xterm.js Flow control guide](https://xtermjs.org/docs/guides/flowcontrol/)). A
  runaway `yes` / `cat /dev/zero` will otherwise degrade the UI and bloat the socket.
- Standard pattern: `pty.pause()` while `term.write` is backlogged, `pty.resume()` on
  the write callback, ideally with a high/low watermark (guide recommends HIGH < 500 KB)
  ([Flow control guide](https://xtermjs.org/docs/guides/flowcontrol/)). node-pty also
  exposes `handleFlowControl` / `flowControlPause` / `flowControlResume` and `pause()`
  /`resume()` for this.
- WebSocket buffers can't be flow-controlled directly — the guide warns to treat the
  socket as "a datasink with infinite buffers and unknown latency"; spanning ACK
  accounting across the socket needs an agreed measure
  ([Flow control guide](https://xtermjs.org/docs/guides/flowcontrol/)). ttyd's
  PAUSE/RESUME command bytes are a concrete production example of doing this on one
  socket.
- OS-level caps: set `rlimit`s (cpu time, address space, nproc) for the shell — e.g. a
  `ulimit` preamble in the spawned shell, or cgroup/Docker memory+CPU limits for the
  container. Kill the pty on disconnect and enforce an idle/lifetime timeout.

### Treat terminal output as untrusted (DOM/JS boundary)

- "anything coming from the terminal might contain malicious data … treat terminal data
  always as untrusted when dealing with it on the DOM-level"
  ([xterm.js Security guide](https://xtermjs.org/docs/guides/security/)). xterm.js's
  renderers keep terminal bytes out of the JS/DOM boundary; the leak points are
  `onTitleChange`, the linkifier, `buffer` access, and custom parser hooks.
- Apply that data safely: "open links presented from terminal side in a separate
  context, **no innerHTML**"; no eval/fetch-from-terminal output
  ([xterm.js Security guide](https://xtermjs.org/docs/guides/security/)). Since we plan
  a read-only file viewer and link handling, keep terminal-originated text out of any
  HTML sink.

---

## 4. Managing multiple concurrent terminals (one per project)

- **Model:** one pty per open project terminal, keyed by a stable terminal/session id
  (not by pid — pids are reused). A `Map<id, IPty>` (the xterm.js demo keys by
  `term.pid` in a `terminals` map; we should key by our own id so resize/kill/disconnect
  target the right instance).
- **Lifecycle:** spawn on first open (or on project switch), `pty.kill()` on socket
  close / tab close / logout, and delete the map entry. The official demo buffers pty
  output from spawn until the WS attaches and flushes it on connect — do the same so
  early output isn't lost.
- **Resize targets the right instance** via the id (`/terminals/:id/size`), not a global.
- **Caps:** a maximum number of concurrent terminals per user (ttyd's `-m
  --max-clients` is the reference), an idle timeout that kills and reaps ptys, and
  `onExit` wired to clean the map and notify the client.
- **Binding to the project:** each pty's `cwd` is the project's directory; the Agent SDK
  session and the terminal share the same project directory (per the standing decisions
  in `AGENTS.md`), so key both by the same project id.
- **node-pty caveat:** it is **not thread-safe** — don't spread pty instances across
  worker threads ([node-pty README](https://github.com/microsoft/node-pty)). Keep all
  pty handles on the main event loop of the backend process (fine for Node's async
  model).

---

## Sources

- node-pty README (API, platforms, ConPTY, Node 16+, security warning, not thread-safe): https://github.com/microsoft/node-pty
- node-pty typings (exact `IPty`/`spawn` surface, `uid`/`gid`, `handleFlowControl`, `useConpty`): https://raw.githubusercontent.com/microsoft/node-pty/main/typings/node-pty.d.ts
- xterm.js attach addon source (binaryType arraybuffer, raw onData/onBinary/message, no resize): https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-attach/src/AttachAddon.ts
- xterm.js attach addon README: https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-attach/README.md
- xterm.js "Using addons" guide: https://xtermjs.org/docs/guides/using-addons/
- xterm.js official demo server (node-pty + express-ws, raw input, resize via HTTP POST, kill on close): https://raw.githubusercontent.com/xtermjs/xterm.js/master/demo/server/server.ts
- xterm.js demo client (resize via `fetch` POST): https://raw.githubusercontent.com/xtermjs/xterm.js/master/demo/client/client.ts
- xterm.js demo server @5.0.0 (ws variant): https://raw.githubusercontent.com/xtermjs/xterm.js/5.0.0/demo/server.js
- xterm.js Flow control guide (pause/resume, watermark, 50 MB buffer, WS backpressure): https://xtermjs.org/docs/guides/flowcontrol/
- xterm.js Security guide (untrusted terminal data, no innerHTML, wss): https://xtermjs.org/docs/guides/security/
- ssh2 (SSH client/server library, `conn.shell`, `stream.setWindow(rows, cols)`): https://github.com/mscdex/ssh2
- WebSSH2 (ssh2 + xterm.js + socket.io; host-key verification, CIDR subnet restrictions, auth): https://github.com/billchurch/WebSSH2
- wetty (node-pty + socket.io + xterm.js app; `--allowed-origin`, auth flags, `/bin/login` vs ssh): https://github.com/butlerx/wetty
- wetty package.json (confirms node-pty + socket.io, no ssh2/ws): https://raw.githubusercontent.com/butlerx/wetty/master/package.json
- ttyd (C app; `--check-origin`, `-u/-g`, `-w`, `-W` read-only, `-c`, `-m`): https://github.com/tsl0922/ttyd
- ttyd client protocol (command-byte framing; resize `{columns, rows}`; PAUSE/RESUME): https://raw.githubusercontent.com/tsl0922/ttyd/main/html/src/components/terminal/xterm/index.ts
