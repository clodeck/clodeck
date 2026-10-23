# Deployment

Clodeck is built to run on the machine that holds your projects: a dedicated box, reachable from
whatever browser you happen to be at. It is the same app and the same environment variables as the
[quickstart](../README.md#quickstart) — only the way the browser reaches it changes.

| Your situation | Route |
|---|---|
| Trying it out, or developing | [Quickstart](../README.md#quickstart) on your own machine |
| A server, no domain, just you | [The direct route](#the-direct-route) — a bare `http://<ip>:<port>` origin, with the password and every session byte **in cleartext** |
| A server, no domain, and you want encryption | [The SSH tunnel](#the-ssh-tunnel) — nothing exposed, but no phone and no bookmark — or [Caddy's internal certificate](#caddys-internal-certificate) — a real `https:` origin at the price of installing a root CA on each device |
| A server with a domain you own | [Docker Compose with a domain](#docker-compose-with-a-domain) — real HTTPS from any browser |
| A server behind your own proxy | Bind the app to `127.0.0.1:3001`, terminate TLS in that proxy, and set `CLODECK_PUBLIC_URL` to the origin the browser uses — plus `CLODECK_TRUSTED_PROXIES=127.0.0.1/8`, so the login lockout counts failures against the browser rather than the proxy |

Every route runs the same build. `npm run serve` is the deployment command: it checks the
configuration, builds all three packages and starts the server against the client it has just built,
so one process serves the whole app on one port.

## The direct route

A server with a public IP and no domain is the most ordinary deployment there is, and it works. Bind
the app to the network, declare the origin a browser will type, and the session sticks — any browser
on any device can bookmark it, with nothing installed on the client and no tunnel to hold open.

```sh
HOST=0.0.0.0 \
CLODECK_PUBLIC_URL=http://203.0.113.10:3001 \
UI_PASSWORD='a-long-password' \
PROJECTS_ROOT=/srv/clodeck-projects \
  npm run serve
```

**`CLODECK_PUBLIC_URL` is the whole trick, and its cost belongs in the same breath: there is no TLS,
so the password, every chat message and every byte of terminal output cross the network in
cleartext.** Anyone on the path can read them. That is the trade for reaching the app from a phone
with no domain, and it is said twice — the server warns at startup, and the login screen says it
where you type the password. Declare the same origin with `https:` and the session cookie is `Secure`
again, which is what the encrypted routes are for.

**Undeclared, nothing changes.** With no `CLODECK_PUBLIC_URL` the cookie stays `Secure`, exactly as it
always was — and a bare `http://` origin then gets the bounce described in
[When the origin is not declared](#when-the-origin-is-not-declared).

If you would rather encrypt it, three routes do that:

1. **An SSH tunnel** — the app appears on `http://localhost:…` of your own machine, nothing exposed
   and nothing to configure on the server, but it takes a tunnel: no phone, no bookmark.
2. **Caddy's internal certificate** — a real `https:` origin with no domain, at the price of
   installing Caddy's root CA on every device.
3. **A domain and Let's Encrypt** — nothing to install on any client, which is why it is the one to
   pick once you have a domain.

## Linux server

Tested on Debian and Ubuntu. Any distribution with Node 22 works.

**Prefer to be walked through it?** `bash scripts/deploy-clodeck.sh` is this section *with* you rather
than *to* you: it installs the prerequisites, asks for the projects root, the login password, the
endpoint and any provider tiers, then writes `/etc/clodeck/clodeck.env` and the systemd unit, opens
the port in the firewall, and waits for `/healthz` to answer. Re-running it is how you change a value.

### Prerequisites

```sh
# Node 22 (NodeSource). Alternatives: nvm, or your distribution's package if it is 22+.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# git, and the toolchain node-pty compiles against
sudo apt-get install -y git python3 make g++
```

Then **run it as a dedicated user, not as root** — the terminal panel is a real shell, and it runs
with the server's privileges (see [Security](security.md)).

```sh
sudo useradd --create-home --shell /bin/bash clodeck
sudo mkdir -p /srv/clodeck-projects && sudo chown clodeck:clodeck /srv/clodeck-projects
```

### Install and run

```sh
sudo -u clodeck -i
git clone https://github.com/clodeck/clodeck.git /home/clodeck/clodeck && cd /home/clodeck/clodeck
npm ci                 # ci, not install: this is a deployment, and the lock file is the contract

# the password in a file rather than an environment variable
mkdir -p ~/.config/clodeck && (umask 077; printf 'a-long-password' > ~/.config/clodeck/password)

PROJECTS_ROOT=/srv/clodeck-projects \
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password \
ANTHROPIC_API_KEY=sk-ant-... \
  npm run serve
```

`npm run serve` is the deployment path: the preflight refuses to build anything until it can see a
password and a projects root, then it builds and starts the server against the client it has just
built. `WEB_ROOT` needs no value here — unset, the build that command made is found and logged.

(The key is inline here for brevity; the systemd unit below keeps it in a root-owned file instead.)

`clodeck server listening on http://127.0.0.1:3001` and `curl http://127.0.0.1:3001/healthz` →
`{"status":"ok"}` mean it is up. The bind address stays loopback: the tunnel reaches it, the network
does not. Then open [The SSH tunnel](#the-ssh-tunnel) and point it at **3001**.

To reach it from other machines directly instead — from a phone, with no tunnel to hold open — add
`HOST=0.0.0.0` and `CLODECK_PUBLIC_URL=http://<the address a browser types>:3001` to the same
environment. That is [the direct route](#the-direct-route), and it puts the password and every byte
of the session on the wire in cleartext.

### Keep it running — a systemd unit

```ini
# /etc/systemd/system/clodeck.service
[Unit]
Description=Clodeck
After=network.target

[Service]
Type=simple
User=clodeck
WorkingDirectory=/home/clodeck/clodeck/server
ExecStart=/usr/bin/node dist/main.js
EnvironmentFile=/etc/clodeck/clodeck.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
# /etc/clodeck/clodeck.env — chmod 600, root-owned
PROJECTS_ROOT=/srv/clodeck-projects
# optional: unset, the server finds the build by walking up from its working directory, and logs it
WEB_ROOT=/home/clodeck/clodeck/web/dist
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password
ANTHROPIC_API_KEY=sk-ant-...
```

```sh
sudo chmod 600 /etc/clodeck/clodeck.env
sudo systemctl daemon-reload && sudo systemctl enable --now clodeck
sudo journalctl -u clodeck -f
```

`WorkingDirectory` is load-bearing twice over: `dist/main.js` resolves against it, and so does
`clodeck.config.json` (see [Configuration](configuration.md)).

## Windows server

The app runs on Windows unmodified: no compiler is needed (`node-pty` ships a prebuilt binary), and
the terminal drawer opens PowerShell rather than bash.

```powershell
# Node 22 — winget, or the installer from nodejs.org
winget install OpenJS.NodeJS.LTS
node --version      # must be 22.12 or newer

# Optional, and only if you want to reach it over SSH from another machine —
# Windows ships the client, and the server is one optional feature:
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

```powershell
git clone https://github.com/clodeck/clodeck.git $HOME\clodeck
cd $HOME\clodeck
npm ci

$env:PROJECTS_ROOT = "D:\projects"
$env:UI_PASSWORD = "a-long-password"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm run serve
```

Open [The SSH tunnel](#the-ssh-tunnel) and point it at **3001**.

Two Windows notes:

- **Do not open a firewall rule for this.** The tunnel is the way in, and it needs no inbound port.
  Serving other machines directly is [the direct route](#the-direct-route): it works once the origin
  is declared, and it puts the password and every byte of the session on the wire in cleartext — so
  open the port when you mean it, not by accident.
- **The command above is a foreground process.** For a service, run it under
  [NSSM](https://nssm.cc) or a Scheduled Task at startup, or take the [Docker](#docker) route on a
  Linux host and keep the Windows box as the client.

## Docker

The image is the whole product — production dependencies plus the three `dist/` trees, running as the
image's unprivileged `node` user. The server serves the built client, so there is no Vite and no
second process.

```sh
docker build -t clodeck .
```

**No domain? Run it on loopback and tunnel to it.** This is the shortest path to a working server, and
the encrypted one:

```sh
# /etc/clodeck/clodeck.env — chmod 600
#   PROJECTS_ROOT=/projects
#   UI_PASSWORD=a-long-password
#   ANTHROPIC_API_KEY=sk-ant-...

docker run -d --name clodeck --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  --env-file /etc/clodeck/clodeck.env \
  -v /srv/clodeck-projects:/projects \
  -v clodeck-sessions:/home/node/.claude \
  clodeck
```

- **`-p 127.0.0.1:3001:3001`** publishes to the host's loopback only. The tunnel reaches it; the
  internet does not. Dropping the `127.0.0.1:` is how you reach it from other machines instead — that
  is [the direct route](#the-direct-route), and it needs `CLODECK_PUBLIC_URL` in the env file, set to
  the origin the browser types, or the login will bounce
  ([why](#when-the-origin-is-not-declared)).
- **`-v /srv/clodeck-projects:/projects`** is where the projects *are*. The container runs as uid
  1000, so that directory has to be writable by it: `sudo chown -R 1000:1000 /srv/clodeck-projects`.
  Read-only is enough for browsing, and not enough for creating a project, uploading a file or letting
  the agent edit anything.
- **`-v clodeck-sessions:/home/node/.claude`** is the Agent SDK's transcript store — chat history
  survives a container restart. It is deliberately *not* the host user's own `~/.claude`.
- **`--env-file`** keeps the values out of your shell history. They are still visible to
  `docker inspect`; for the stricter shape, mount a file and use `UI_PASSWORD_FILE` instead — that is
  what the compose deployment below does.

`curl http://127.0.0.1:3001/healthz` → `{"status":"ok"}` means it is up. Then
[The SSH tunnel](#the-ssh-tunnel), pointed at **3001**.

## Docker Compose with a domain

The full deployment: the app, plus Caddy in front of it terminating TLS. Caddy is the only service
with published ports, so the app is reachable on the compose network and nowhere else.

**You need:** a domain whose A record points at this host, and **ports 80 and 443 reachable from the
internet** — the certificate is obtained and renewed automatically (Let's Encrypt). There is no cert
file to manage.

```sh
mkdir -p secrets
openssl rand -base64 24 > secrets/ui_password.txt   # this becomes the login password
cat > .env <<'EOF'
CLODECK_DOMAIN=clodeck.example.com
PROJECTS_ROOT=/srv/clodeck-projects
ANTHROPIC_API_KEY=sk-ant-...
UI_PASSWORD_FILE=./secrets/ui_password.txt
EOF
docker compose up -d
```

`docker compose` reads `.env` from this directory automatically, so `docker compose up -d` is the
whole happy path. Then `curl https://$CLODECK_DOMAIN/healthz` answers `{"status":"ok"}`, and
`https://$CLODECK_DOMAIN` is the login screen; sign in with the contents of the password file.

| Variable | What it is |
|---|---|
| `CLODECK_DOMAIN` | The public hostname. It is Caddy's site address and the name on the certificate, so it must resolve to this host. Required — compose refuses to start without it. |
| `PROJECTS_ROOT` | The **host** directory whose immediate child directories are the projects. Bind-mounted at `/projects` inside the app. Same uid 1000 ownership rule as above. Required. |
| `ANTHROPIC_API_KEY` | Read by the Agent SDK from the app's environment. Compose **requires** it, but the app boots either way: a wrong key fails at the first chat turn, and the login screen, the terminal and the file drawer work regardless. |
| `UI_PASSWORD_FILE` | A file whose trimmed contents are the login password. Compose mounts it at `/run/secrets/ui_password`; the password is never an environment variable (it would show up in `docker inspect`) and never an image layer. Defaults to `./secrets/ui_password.txt`. |

**Caddy's address is declared to the app**, as `CLODECK_TRUSTED_PROXIES: 172.16.0.0/12` in the compose
file — Docker's own pool, so this costs you nothing. It is what the login lockout keys on: without it
every login arrives from Caddy, and five failures from anyone would lock out the one user there is
([what the variable does](configuration.md), and why, under [Security](security.md)). Swapping Caddy
for a proxy on another network means changing that value — or setting it in your own compose override.

Three volumes keep state across restarts: `claude-data` (the Agent SDK's transcript store, at
`/home/node/.claude`), and `caddy-data` / `caddy-config` (the issued certificates and the ACME account
key — losing them means re-obtaining every certificate on the next start).

Only what the app needs is in the image: production dependencies and the three `dist/` trees.
`node-pty`'s Linux binding is compiled during the build — the tarball ships prebuilds for macOS and
Windows only — which is why the dependency stage carries a toolchain and the shipped image does not.
Everything is Debian (glibc) because the SDK ships a native `claude` binary; the container runs with
`init: true` so `docker compose stop` delivers a real `SIGTERM`.

**If you already run a reverse proxy**, skip this compose file: publish the app on the proxy's network
(`127.0.0.1:3001:3001`), terminate TLS in front of it, and set `CLODECK_PUBLIC_URL` to the `https:`
origin the browser uses — the one fact the app cannot see from behind a proxy. Add
`CLODECK_TRUSTED_PROXIES` for that proxy's address (`127.0.0.1/8` when it is on the host) unless you
want the login lockout to see one client where there are many. Nothing in the app requires Caddy.

## Day-to-day with the containers

| Task | Command |
|---|---|
| Logs | `docker compose logs -f app` — or `docker logs -f clodeck` for a standalone container |
| Health | `curl -s http://127.0.0.1:3001/healthz`; compose also healthchecks the app and Caddy every 30s |
| Update | `git pull && docker compose up -d --build` (compose) or `docker build -t clodeck . && docker rm -f clodeck && docker run …` again |
| Restart | `docker compose restart app` — but note a restart **drops every session**: session ids live in the server's memory, so you log in again |
| Change the password | Edit `secrets/ui_password.txt`, then `docker compose up -d` to recreate the container. The new password is hashed at boot. |
| Back up chat history | The transcripts are in the `claude-data` volume (`/home/node/.claude`): `docker run --rm -v clodeck_claude-data:/from -v "$PWD:/to" alpine tar czf /to/claude-data.tgz -C /from .` — compose prefixes the volume with the project's directory name, so check `docker volume ls` for the real one |

## Reaching it from another machine

### The SSH tunnel

A tunnel makes the app appear on your own `localhost`, which browsers treat as a trustworthy origin
whatever the scheme — so the session cookie stays `Secure` and SSH encrypts every byte end to end.
Nothing is exposed, and nothing on the server side needs configuring. The price is the tunnel itself:
no phone, no bookmark.

| What you are running on the server | Tunnel | Open |
|---|---|---|
| `npm run dev` (the dev loop) | `5173` | <http://localhost:5173> |
| `npm run serve`, or Docker | `3001` | <http://localhost:3001> |

```sh
# macOS, Linux, and Windows PowerShell or Windows Terminal — OpenSSH is built in
ssh -N -L 3001:127.0.0.1:3001 clodeck@your-server

# the dev loop instead of the built client
ssh -N -L 5173:127.0.0.1:5173 clodeck@your-server

# both at once, if you are switching between them
ssh -N -L 3001:127.0.0.1:3001 -L 5173:127.0.0.1:5173 clodeck@your-server
```

`-N` means "no remote shell — just forward the port"; the command sits there while the tunnel is open,
and `Ctrl-C` closes it. Then open the URL in the table above. Notes:

- **Windows clients need nothing installed** — `ssh` is part of Windows 10+. A non-default port is
  `-p 2222`, and a key is `-i $HOME\.ssh\id_ed25519`.
- **No `--host 0.0.0.0` anywhere.** Vite binds `localhost` by default, which is exactly what the
  tunnel reaches, and opening it to the network would put a dev server with no auth of its own on a
  public port. Reaching the app from other machines is [the direct route](#the-direct-route), where
  the server serves the built client — not Vite.
- **`clodeck@` is whichever account owns the install** — `clodeck` for the systemd setup above,
  `root@` if you installed under root.
- **The tunnel survives a laptop sleep only if you tell it to**: add `-o ServerAliveInterval=30
  -o ServerAliveCountMax=3`, or run it under `autossh -M 0`.
- **Leaving it open is fine.** A tunnel binds your own loopback; it is not an open port, and it stops
  the moment you close it.

### Caddy's internal certificate

If you want the direct route's reachability without the cleartext, and you have no domain, Caddy can
issue the certificate from its **own local authority** instead of Let's Encrypt — the
[`tls internal`](https://caddyserver.com/docs/caddyfile/directives/tls#tls) directive, one line added
to the compose stack's Caddyfile. The caveat is the whole story: no browser trusts that authority, so
every device needs its root CA **installed** before the warning goes away — Caddy's root CA lands in
the `caddy-data` volume and has to be copied onto each client. On iOS, installing the profile is only
half of it: the certificate then has to be trusted under **Settings → General → About → Certificate
Trust Settings**, and a warning clicked through is not enough. A laptop tolerates a warning; the phone
bookmark this route exists for does not. [Docker Compose with a domain](#docker-compose-with-a-domain)
stays the route with nothing to install anywhere.

```caddyfile
# The compose Caddyfile with that one line added. The site address still needs no
# public domain — `CLODECK_DOMAIN` can be any name that resolves to this machine,
# so a LAN name in each device's hosts file is enough — and Caddy now serves it
# over HTTPS with a certificate from its own CA, asking nothing of Let's Encrypt.
{$CLODECK_DOMAIN} {
	tls internal
	reverse_proxy app:3001 {
		health_uri /healthz
		health_interval 30s
	}
}
```

### When the origin is not declared

Point a browser at the app by IP over HTTP — `http://203.0.113.10:3001`, or the dev server started
`--host 0.0.0.0` at `http://203.0.113.10:5173` — **without declaring that origin**, and you get a
specific, confusing failure. Type the password and the screen flickers and stays on the sign-in form.
No error message, no failed login in the server's log. Quite the opposite: the server logs a
*successful* login. DevTools shows it plainly:

```http
POST http://203.0.113.10:3001/api/auth/login   →  200
GET  http://203.0.113.10:3001/api/auth/me      →  401
```

The cause is one flag. With no `CLODECK_PUBLIC_URL`, the session cookie is set `Secure`
(`server/src/auth/transport.ts`):

```http
Set-Cookie: clodeck_session=…; HttpOnly; Secure; SameSite=Strict; Max-Age=…
```

A browser accepts a `Secure` cookie **only** from an HTTPS origin, or from `localhost` / `127.0.0.1` /
`[::1]` — which are special-cased as trustworthy. `http://203.0.113.10:3001` is neither, so the
browser throws the `Set-Cookie` away. The next request carries no cookie, the auth gate answers 401,
and the client — which reads the principal from `/api/auth/me` rather than assuming one — returns you
to the sign-in screen. Chrome says it out loud in the Console:

```text
This Set-Cookie was blocked because it had the "Secure" attribute but was not received over a secure connection.
```

You can watch the server do everything right, cookie and all, from a shell that has no such rule:

```sh
curl -i -X POST http://203.0.113.10:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"password":"a-long-password"}'
# 200, and a Set-Cookie line with Secure on it
```

**The fix is to declare the origin, not to weaken the cookie.** In this exact case
`CLODECK_PUBLIC_URL=http://203.0.113.10:3001` is what makes the cookie non-`Secure` and the login
hold — that is [the direct route](#the-direct-route), cost included. Reaching the app over HTTPS
instead keeps the cookie `Secure` and drops the cost: use
[Docker Compose with a domain](#docker-compose-with-a-domain), an [SSH tunnel](#the-ssh-tunnel), or
[Caddy's internal certificate](#caddys-internal-certificate). What is *not* a fix is a browser flag
that calls the origin secure (`chrome --unsafely-treat-insecure-origin-as-secure=…`): it is
per-machine, temporary, and leaves the traffic readable to everyone else on the path.
