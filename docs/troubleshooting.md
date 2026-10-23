# Troubleshooting

Symptom-first answers to the failures people actually hit. Start with the server's first lines of
output — its warnings name their own fix.

## I sign in and land back on the sign-in screen

**The signature of an undeclared origin.** The browser reached the app at an `http://` address that is
not `localhost`, the session cookie went out `Secure` — the default, because no `CLODECK_PUBLIC_URL`
was declared — the browser discarded it, and the next call was answered `401`. Nothing is wrong with
the server, and no amount of reading its log will show it: it logs the login as a success.

Open DevTools → Network and look for `POST /api/auth/login → 200` followed by
`GET /api/auth/me → 401` (the Console also reports the blocked cookie). Then:

- **Reaching a server by IP?** Declare it: put `CLODECK_PUBLIC_URL=http://<the address the browser
  typed>:<port>` in the server's environment and restart. That is
  [the direct route](deployment.md#the-direct-route) — the cookie follows the declared scheme and the
  login holds — and it is cleartext on the wire.
- **Prefer encryption?** An [SSH tunnel](deployment.md#the-ssh-tunnel) needs no configuration and
  keeps the `Secure` cookie; [Caddy's internal certificate](deployment.md#caddys-internal-certificate)
  or [a domain](deployment.md#docker-compose-with-a-domain) give a real `https:` origin.
- **Just started it locally?** You are on `http://localhost:5173` — check that the host in the address
  bar really says `localhost` or `127.0.0.1`, not the machine's LAN IP from the `Network:` line Vite
  prints next to `Local:`. That line is for other devices, and reaching it is
  [the direct route](deployment.md#the-direct-route) — same declaration, with `:5173` as the port.
- The full mechanism is in
  [When the origin is not declared](deployment.md#when-the-origin-is-not-declared).

## The client answers 502 for everything

A 502 from the client is the **proxy** failing, not the app: Vite could not reach the backend, and the
backend's own log says nothing at all — because it never started. On Windows the usual cause is that
the OS is holding the port:

```text
Error: listen EACCES: permission denied 127.0.0.1:3001
```

Hyper-V and WSL reserve themselves dynamic port ranges at boot — commonly `2980–3079`, which contains
3001 — and everything inside them is unbindable. See them with:

```sh
netsh interface ipv4 show excludedportrange protocol=tcp
```

Two ways out. Move the port (`PORT=3300 npm run dev` — the proxy follows it), or hand the ranges back
for this boot with an **elevated** shell:

```sh
net stop winnat && net start winnat
```

Nothing about the app is wrong in either case: no code change, no config change, and no amount of
reading the server's log will show it. On Linux the same 502 means `EADDRINUSE` — something else is on
3001 — and `PORT` moves it just the same. Vite's own port moves too if 5173 is taken: read the `Local:`
line it prints rather than assuming.

## The sidebar is empty, though the folder has directories in it

`PROJECTS_ROOT` did not reach the server as the path you meant — and that failure is quiet by design,
because the server's answer to a root it cannot use is an empty list, never an error. The tell is its
warn line, and it says which of the two happened: `no projects root configured — …` when nothing
arrived at all, and `could not read projects root <path>: …` when something arrived that is not a
readable directory. Three traps:

- **Git Bash on Windows eats the backslashes** in `PROJECTS_ROOT=D:\work\projects`: the server then
  scans `D:workprojects` and finds nothing. Use forward slashes (`/d/work/projects`).
- **Only immediate child directories are projects.** One level deeper is not listed; a plain file or a
  dot-directory (`.git`, `.cache`) is not either. A symlink counts, but only if what it points at is
  inside the root.
- **In Docker, `PROJECTS_ROOT` is the path *inside* the container** (`/projects`), and the host
  directory arrives through `-v`. Setting it to the host path inside the container finds nothing.

## The app cannot write to the projects directory

Reading works, creating or saving fails. The container — and the image — runs as uid 1000 (`node`), so
the bind-mounted projects directory must be writable by that uid:

```sh
sudo chown -R 1000:1000 /srv/clodeck-projects
```

On a native install the equivalent mistake is running the server as one user while the projects belong
to another. See also [Security](security.md) — running it as root is not the fix, it is a bigger
problem.

## The login screen refuses the password I set

`UI_PASSWORD` was unset or blank — a blank value counts as unset — so the server is fail-closed and the
boot warning says which (`UI_PASSWORD is not set: …`). Two more things that look like a wrong password:
`UI_PASSWORD_FILE` is read **only** when `UI_PASSWORD` is unset, and the password is hashed once at
boot, so changing it needs a restart — which also drops every session, since sessions live in the
server's memory. Five failures from one address lock it out for fifteen minutes (a `429`); the login
route answers that even for the correct password.

## Everything works except the chat's answer

The chat turn is the one thing that needs a credential: `ANTHROPIC_API_KEY` in the server's
environment, or a profile's `CLODECK_PROVIDER_<NAME>_AUTH_TOKEN`
([Provider profiles](configuration.md#provider-profiles)). Without one the login, the terminal, the
file drawer and history all work and the turn fails; `npm run dev:fake` is the offline stand-in, and a
*wrong* key fails at the first turn with the SDK's own error in the chat.

**A turn that answers `Not logged in · Please run /login` is this, and the wording is the Agent SDK's**
— it names a Claude Code CLI command, not Clodeck's login screen, and it means the server's environment
carried no credential at all. The common cause is a credential that lives in `.env` while the server
was started by something that does not read it: `npm run dev` reads no file, so the variables you put
in front of it arrive and the rest of the file does not. Start the loop with `npm run dev:env` when
`.env` is where your values are, and with `start-clodeck.*` when you are running `serve`.

## npm install fails on Linux

`node-pty` has no prebuilt Linux binary, so its install script compiles one and needs a toolchain. The
failure names a missing `python3`, `make` or `g++` (`gyp ERR! find Python`, `gyp ERR! stack Error: not
found: make`):

```sh
sudo apt-get install -y python3 make g++
```

The [Docker](deployment.md#docker) path never sees this: the image builds the binding in a stage that
has the toolchain, and copies the result into an image that does not.
