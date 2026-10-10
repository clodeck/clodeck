# 14: Web terminal — xterm.js panel over the raw socket

**What to build:** In the app shell, the Terminal stub becomes a real interactive xterm.js terminal bound to the selected project: keystrokes reach the shell, output (colors and cursor control) renders, resizing the panel resizes the pty, and switching projects tears the old socket down cleanly.

**Blocked by:** 13

**Status:** resolved

- [x] A `useTerminal(project)` data seam (shaped like `useChat` / `useProjects`) owns the xterm instance and the raw socket and cleans both up on unmount.
- [x] `TerminalPanel` replaces the Terminal stub, keyed by project id, mounting xterm.js with the attach addon on the raw `/ws/terminal` socket.
- [x] Panel resize is wired (debounced) to the resize endpoint.
- [x] Terminal output renders only through xterm.js — no `innerHTML`, no HTML sink for terminal bytes.
- [x] `@xterm/xterm` and `@xterm/addon-attach` are web dependencies; typecheck and build pass.

## What landed

```
web/src/terminal/useTerminal.ts       the seam: state union + one effect owning the Terminal and the raw socket
web/src/terminal/TerminalPanel.tsx    the panel — a container, a title, and the connection pill
web/src/terminal/transport.ts         the pure edges: socket URL, resize POST, the trailing-edge debounce, TerminalSize
web/src/terminal/transport.test.ts    7 tests for those pure edges
web/src/App.tsx                       the Terminal stub becomes <TerminalPanel key={project.id} project={project} />
web/package.json                      @xterm/xterm ^6.0.0, @xterm/addon-attach ^0.12.0, @xterm/addon-fit ^0.11.0
```

- **One effect owns both long-lived objects.** The `Terminal`, the `WebSocket`, the attach addon, the
  fit addon, the `ResizeObserver` and the resize subscription are all created in the same
  `useEffect([project.id, container])`; the cleanup detaches the socket handlers first, then disposes
  the subscription, cancels the pending debounce, disconnects the observer, disposes the addons, the
  terminal and the socket. Keying `TerminalPanel` by project id is what makes a project switch a
  remount — and therefore a clean teardown — rather than a second live socket.
- **The attach addon *is* the byte channel.** `new AttachAddon(socket)` handles both directions
  verbatim, and the server's string frames round-trip through it; no framing layer, no
  `protocol.ts` import anywhere in the terminal code.
- **Resize is hand-wired, because the addon never sends one** (research 02 §2). A `ResizeObserver` →
  `fit.fit()` changes the grid → `terminal.onResize` → a 150 ms trailing-edge debounce → `POST
  /api/projects/:id/terminal/size`. The real size is also pushed once on `socket.onopen`, because the
  server spawns at a fixed 80×24; sizes are dropped while the socket is not OPEN (before it opens the
  server has no terminal, so the POST would 404).
- **No HTML sink.** Terminal bytes reach the screen only through xterm's renderer: the ctor
  configures no linkifier and installs no parser hook, and a grep of `web/src` for `innerHTML`,
  `dangerouslySetInnerHTML`, `document.write`, `insertAdjacentHTML` and `outerHTML` returns only the
  comment saying not to do it.
- **`@xterm/addon-fit` is a third xterm package beyond the two the spec names.** User story 8
  ("resizing the panel resizes the pty") requires the grid to actually change size, and only a
  fit/measure step does that. Reviewed and accepted as a justified deviation (the spec's dependency
  list is what is stale, not the code). It went in the review pass' record in ticket 13.

## Known gaps

- **No browser verification.** The panel — keystroke round-trip, colours, cursor control, live
  resize, project-switch teardown — is verified only by `typecheck`, `build`, the seven pure-edge
  tests, and the server-side real-shell check in ticket 13. Nothing the DOM produces is asserted by a
  test; that is the same limit slice 02 recorded, and it stands because this session had no browser.
  **Someone should open `npm run dev` and type into the terminal once.**
- **The attach addon throws if you type before the socket is OPEN** ("Attach addon was loaded before
  socket was open"). It was left verbatim rather than wrapped — the window is the sub-second connect
  and the official xterm.js demo behaves identically — but a fast typist on a slow link can hit it.
- **There is no reconnect.** A closed socket is `error` ("Closed" in the pill), because a shell does
  not survive a gap: a reload is a fresh shell. If the server closes the socket because the shell
  exited, the panel says so rather than respawning.
- **The web bundle grew to 584 kB** (160 kB gzip) — the xterm footprint, and Vite's >500 kB advisory
  now fires on every build. Dynamically importing xterm inside the effect would split it back out;
  the static import was chosen deliberately because it keeps the seam simple and stays safe under
  vitest's node environment.
- Tests run in vitest's default **node** environment (no `jsdom`/`happy-dom`, no `vitest.config.*`).
  That is why the static `@xterm/xterm` import in the panel's module graph is load-bearing knowledge,
  not a style choice: `App.test.tsx` evaluates it.

## Evidence

```
npm run typecheck   → clean
npm test            → shared 7 | server 107 passed, 1 skipped | web 34 passed (3 files)
npm run build       → clean; web dist index.css 17.27 kB, index.js 584.34 kB (gzip 160.63 kB)
```
The web suite is 34 tests across `App.test.tsx`, `chat/reducer.test.ts` and
`terminal/transport.test.ts` (up from 27) — the first two are pre-existing and stayed green, which is
also the proof that the static xterm import does not break the node test environment.

The built CSS genuinely carries xterm's stylesheet (80 `.xterm*` selectors, including `.xterm-viewport`,
`.xterm-screen`, `.xterm-helper-textarea`), so `@xterm/xterm/css/xterm.css` is bundled, not dropped.

Merged as `5a31470` (branch `clodeck/14-web-terminal-panel` @ `21f3b96`); the merge reviewer read the
cleanup path and the resize wiring in the source, ran the HTML-sink grep itself, and confirmed the
static-import claim by tracing the real import graph (`App.test.tsx` → `App` → `TerminalPanel` →
`useTerminal` → xterm) rather than taking it on trust.
