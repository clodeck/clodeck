# Clodeck — terminal slice (per-project PTY + xterm.js)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Do slice-e ghabl (chat/transport) ye UI-e chat-e streaming dad, amma terminal-e per-project hanooz ye `Stub`-e kholi dar `App.tsx`-e (hamoon cell-e «Terminal lands in a later slice»). Bikarbord-e asli-e Clodeck in ast ke developer betone dar har project ye shell-e interactive-e vaghe'i baz kone — hamoon chiz-i ke «per-project shell terminal» dar AGENTS.md ast va wayfinder 02 qat'i karde. Riski-tarin bakhsh hamin ast ke ye shell-e kamel-e server ro az browser be dast biyavarim bedoone inke server ro be ye primitive-e RCE tabdil konim; va chon node-pty ye native binding ast, test kardanesh bedoone fork-e shell-e vaghe'i hamoon masale-i ast ke SDK-e native dasht.

## Solution

node-pty ro posht-e ye facade (`PtySpawner`) mizarim — hamoon shekl-e `SdkProvider` — va ye route-e WebSocket-e **raw-bytes** dar `/ws/terminal?projectId=…` ro hamin `buildApp` register mikonim ke ba contract-e `@xterm/addon-attach` kar mikone (input = bytes, output = bytes, hich JSON-i nist). Har connection ye PTY-ye project-e khodesh ro spawn va kill mikone; resize az yek endpoint-e REST-e joda miad (`POST /api/projects/:id/terminal/size`). Client xterm.js ro ba `AttachAddon` mount mikone va `terminal.onResize` ro be hamin endpoint vasl mikone. Security: projectId ghabl az spawn az hamin seam-e allowlist (`resolveProject`) rad mishe — daghighan mesl-e `/ws`.

## User Stories

1. As a developer, I want node-pty behind a small interface (spawn/write/resize/kill + onData/onExit), so that automated tests use a scripted fake and never fork a real shell.
2. As a developer, I want node-pty to live in `server` only, so that the native binding never leaks toward the web bundle.
3. As a developer, I want the terminal to be an *addition* to `buildApp` (a third injected seam), so that `main.ts` and the tests reach it through the same app factory as chat.
4. As the user, I want to open a shell for the selected project, so that I can run commands against that project's directory.
5. As the user, I want the shell to start in the project's directory (`cwd`), so that relative paths and project tooling work without `cd`.
6. As the user, I want keystrokes to reach the shell and its output to stream back to the browser, so that the terminal feels native and interactive.
7. As the user, I want the terminal to render colors and cursor control correctly, so that TUI programs and colored output are legible.
8. As the user, I want the terminal to resize when I resize its panel, so that wrapped output and full-screen TUIs follow the layout.
9. As the user, I want the terminal to close cleanly when I switch projects or close the tab, so that no orphan shell keeps running on the server.
10. As the user, I want a terminal that is a fresh shell after a reload, so that I never inherit a half-dead session I cannot see.
11. As a security-conscious operator, I want the `/ws/terminal` project id re-validated against the allowlist before any process is spawned, so that an unauthenticated client cannot open a shell against an arbitrary directory.
12. As a security-conscious operator, I want the terminal output treated as untrusted data (rendered only through xterm.js, never into DOM/HTML), so that a hostile program's output cannot execute code in the browser.
13. As a frontend developer, I want the terminal wired as a data seam shaped like `useChat`/`useProjects`, so that socket lifecycle and cleanup are owned in one place and the mount is declarative.
14. As a developer, I want resize to target the project's current terminal by id, so that the right pty is resized even if more than one exists.
15. As a developer, I want the terminal's byte channel to be completely separate from the JSON `/ws` bus, so that the frozen `protocol.ts` envelope is untouched by this slice.

## Implementation Decisions

### The pty facade (seam-e dovom: node-pty chon native ast)

- node-pty ye native binding ast (mesl-e binary-e Agent SDK), pas hargez mostaghim import nemishe. Ye interface dar `server` — `PtySpawner` — tamam-e chiz-i ke baqie-ye server az pty mikhahad ra expose mikone. In **yek seam-e jadid**-e, va be dalil-e native-bodan node-pty, ghabel-e taghsim nist (hamoon estedlal-e spec-02 bara-ye SDK).
- `PtyHandle`-e facade bar asas-e `IPty`-e node-pty type mishe, vali faghat on chi ke in slice mikhahad:

```ts
interface PtySpawner {
  spawn(options: { cwd: string; cols: number; rows: number }): PtyHandle;
}
interface PtyHandle {
  onData(cb: (data: string) => void): void;
  onExit(cb: (exit: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  pause(): void;
  resume(): void;
}
```

- **Real impl** (`server`-i) faghat module-i ast ke `node-pty` import mikonad: `spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env, handleFlowControl: true, ... })`. Shell = `powershell.exe` dar Windows (dev), `$SHELL`-e mojod ya `bash` dar POSIX (deploy-e Linux/Docker). `env` = `process.env` + `TERM=xterm-256color` + `COLORTERM=truecolor`. node-pty typings-e khodesh ro hamrah dare (hich `@types/node-pty` lazem nist).
- **Fake/scripted spawner** dar test-support (na shipped code): ye `spawn()` ke ye `PtyHandle`-e in-memory bar migardanad; test byte-ha ro script mikone (write moshakhkhas mishe, onData/onExit be dast fire mishe). Hich test-e automati shell fork nemikonad.

### The `/ws/terminal` route (raw bytes, sibling-e `/ws`)

- `/ws/terminal` dar hamin `buildApp` register mishe (ba `@fastify/websocket`, `websocket: true`) — na ye server-e joda. Mesl-e `/ws`, connection project-scoped ast: `?projectId=<id>`. Masir-e `/ws/terminal` zire prefix-e `/ws`-e Vite proxy hast, pas hich taghir dar `vite.config.ts` lazem nist.
- **Security:** bar upgrade, `projectId` decode → `resolveProject` (hamoon allowlist-seam; wayfinder 05 §5) → agar null → socket close (`1008`), hich process-i spawn nemishe. In validation fargh-e beyn-e demo va RCE ast. `cwd` = canonical project path (convenience, na sandbox — shell mitone `cd ..`; wayfinder 02).
- **Raw bytes, hich envelope-i:** data channel be shekl-e `socket.on('message', data => handle.write(data))` va `handle.onData(data => socket.send(data))` ast. JSON-e `protocol.ts` **dast nakhoorde mimoonad** (frozen; handoff). In route hich `ServerEvent`/`ClientMessage`-i nadarad.
- **Lifecycle:** spawn dar connect (socket az pish open ast, pas hich buffering-e pre-attach lazem nist — baraks-e demo-e xterm.js ke HTTP-first ast), kill dar close. Yek pty bar har project (`Map<projectId, PtyHandle>`). `onExit` → socket close + clean-e map. Reload = shell-e jadid (fresh).
- **Flow control:** facade `pause()`/`resume()` expose mikone; client xterm.js backpressure ro be pty vasl mikonad (basic high-watermark). Cap/limit-e joda (max concurrent, idle timeout) az MVP khareje.

### Resize (REST, zire scope-e `/api`)

- `POST /api/projects/:id/terminal/size` ba body-e `{ cols: number; rows: number }` → `resolveProject(:id)` → agar pty-e project hast `handle.resize(cols, rows)` → `200`; vagarna `404` (no terminal). Int → `400`.
- `:id` canonicalize mishe (allowlist), mesl-e hame route-haye `/api/projects/:id/...`-e mojood. Zire hamoon scope-e encapsulated-e `/api` ast, pas principal-aware hook-e wayfinder 07 bad-tar khodkar ghablash miyafte (hamoon shekl-e handoff).
- Dalil-e REST be ja-ye framed-on-WS: data channel 100% raw mimoonad (attach addon verbatim), va resize mutation-i ast ke zire `/api`-e mojood-e authentication-hook-ash jay migirad. CSRF baraye resize dar slice-e auth e'ta' mishe (in slice unauthenticated ast, haman shekl-e `/api/**`).

### Web client

- `@xterm/xterm` + `@xterm/addon-attach` be `web` add mishe. Yek seam-e data, be shekl-e `useChat`/`useProjects`: `useTerminal(project)` ke xterm instance + socket ro `useEffect`-e khodesh saheb mishe va cleanup mikone (dispose terminal + close socket). State union: `connecting | live | error`.
- Mount: `new Terminal(...)` + `loadAddon(new AttachAddon(socket))` + `open(el)`. Resize: `terminal.onResize` → debounce → `POST /api/projects/:id/terminal/size` (attach addon resize nemiferestad; research 02 §2).
- `TerminalPanel`-e jadid be ja-ye `Stub title="Terminal"` dar `App.tsx` minehinad (hamoon cell-e layout; keyed by project id, mesl-e `ChatPanel`).
- Terminal output faghat az xterm.js render mishe — hich `innerHTML`, hich linkifier/parser-hook, hich `dangerouslySetInnerHTML` (research 02 §3). Title/link-handling az MVP kharej.

## Testing Decisions

- **What makes a good test:** assert external behavior — ba'zi bytes vared mishe → `handle.write` ba haman bytes seda mishe; `handle.onData` bytes fire mikone → haman bytes ro socket miad; resize → `handle.resize(cols, rows)`. Hargez node-pty-e vaghe'i, hargez shell fork shode.
- **The two agreed seams (instruction):**
  1. **`buildApp({ projects, provider, spawner })`** — haman Fastify instance, hala ba `/ws/terminal` va `POST /api/projects/:id/terminal/size`. WS-e raw ba `app.listen({ port: 0 })` + ye WS-client-e test (loopback, ephemeral port — haman shekl-e spec-02), ba **fake spawner** injekt shode.
  2. **Fake `PtySpawner`** — ye `spawn()`-e scripted; test lifecycle (connect→spawn, bytes→write, onData→send, close→kill, onExit→close) va resize ra bedoone shell push mikonand.
- **No third seam.** `TerminalManager`-e dakheli (mesl-e `TurnManager`) az hamin do seam test mishe.
- **Coverage that matters:** (a) connect-e allowlisted → `spawner.spawn` ba `cwd`=canonical project path; (b) bytes client→server → `handle.write(bytes)`; (c) `handle.onData` → bytes ro socket; (d) close → `handle.kill()` + map clean; (e) `onExit` → socket close; (f) resize POST → `handle.resize(cols, rows)` + `200`, va `404` vaghti pty nist, `400` bad body; (g) `/ws/terminal` projectId-e ghayr-e allowlist → close + no spawn; (h) reload/reconnect → pty-e jadid (fresh), na reuse.
- **Non-goal:** no live-pty test, no browser e2e (terminal az dev-server drive mishe; node-pty-e vaghe'i manual). Web verified by typecheck/build + by-hand, haman shekl-e spec-02 §Testing (client reducer-test nist chon terminal imperative xterm.js ast).

## Out of Scope

- Auth/login (wayfinder 07) — hamin slice unauthenticated ast; `HOST` loopback mimoonad.
- File viewer / file drawer (wayfinder 03), Docker/Caddy (wayfinder 08).
- Sandboxing-e vaghe'i (bubblewrap/firejail/chroot, node-pty `uid`/`gid` drop) — container-e Docker-e wayfinder 08 dar ayande confinement-e asli ast; in slice faghat cwd = project + allowlist.
- Flow-control-e pishrafte (ttyd-style PAUSE/RESUME framing, rlimit/cgroup caps), idle timeout, max-concurrent-terminal cap, lifetime limit.
- Terminal title/link-handling, copy/paste browser-shortcut handling, output search, scrollback persistence.
- Multiple terminals per project (yek pty bar har project); multi-user (principal-e `"default"`-e ayande).

## Further Notes

- In slice faghat yek seam-e jadid ezafe mikone (`PtySpawner`) va yek route — na dobare-tarhi. `protocol.ts` frozen mimoonad; terminal harges dar envelope nemiyad.
- Ticket-ha az **`12`** edame mikonand (01–11 ghablan estefade shode). Yek split-e tabi'i (baraye `/to-tickets`): (12) `PtySpawner` facade + node-pty dep + fake spawner + `TerminalManager` unit-tested; (13) route-e `/ws/terminal` + resize REST end-to-end dar `buildApp`; (14) web terminal panel (`useTerminal` + `TerminalPanel` + xterm/attach + resize POST).
- `buildApp` signature be `{ projects, provider, spawner }` tabdil mishe; `main.ts` real spawner injekt mikone. Test-ha-ye mojood-e `app.test.ts` be fake spawner update mishavand (mechanical, haman shekl-e slice-e ghabl ke provider injekt shod).
- node-pty native ast: dar Windows dev prebuilt binary dar (ConPTY), dar Linux/Docker build az `node:22-bookworm-slim (glibc)` (wayfinder 08) javab mide. `npm install` dar worktree-ye jadid ye native build ~chand sanie ezafe mikone.
- `main.ts` hanooz `HOST` loopback default mikonad; hich auth nist. `/ws/terminal` sibling-e `/ws` ast va hamoon principal-aware hook-e ayande bayad ghablash biyafte (handoff).
