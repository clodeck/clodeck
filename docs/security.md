# Security

One account, password only, meant to be reachable from the internet — so the boundaries below are
enforced in code rather than stated as intent.

## The login

`POST /api/auth/login` checks the password against a salted **scrypt** hash, built from `UI_PASSWORD`
at boot; the plaintext is never kept. A successful login sets an `HttpOnly; SameSite=Strict` session
cookie, `Secure` unless the deployment declares an `http:` public origin.

Every `/api/**` route plus both `/ws` and `/ws/terminal` require that session. `/healthz` and the two
auth routes are the only exemptions. Logins are rate-limited per address — five failures lock it out
for fifteen minutes, and the lock is checked before the password, so a locked address cannot burn
scrypt cycles. Session ids live server-side, so a logout or a restart invalidates them. A WebSocket
upgrade is refused when its `Origin` is not the host it was sent to.

## The address is the peer's, unless a proxy is declared

`CLODECK_TRUSTED_PROXIES` names the hops whose `X-Forwarded-For` the app believes — Docker's own pool
in the compose deployment, `127.0.0.1/8` for a proxy on the host, nothing at all on the direct and
tunnelled routes.

With none declared, every login behind a proxy shares one bucket, so five failures lock out the
legitimate user along with the attacker; with one declared, the bucket follows the browser. The header
is still only believed from a peer inside the list, and the key is the last hop that peer added — a
client naming somebody else's address ahead of it changes nothing, so a forged header cannot lock out a
user it does not own. A client *inside* a declared range can rotate its own bucket: that is the
accepted cost of declaring one rather than trusting every private address.

## The cookie follows the declared public origin

The `Secure` flag is the one fact the app cannot work out for itself, because behind a TLS-terminating
proxy it sees plain HTTP while the browser sees HTTPS. `CLODECK_PUBLIC_URL` states it once. Undeclared,
the cookie stays `Secure`, so an operator who sets nothing sees no change at all. An `http:` origin
drops the flag, which is exactly what [the direct route](deployment.md#the-direct-route) is and what it
costs.

The reasoning, and the alternatives that were rejected (a `COOKIE_SECURE` boolean, `X-Forwarded-Proto`),
are in [ADR 0001](adr/0001-session-cookie-follows-public-origin.md) — if you came here asking why this
cookie is not always `Secure`, that file is the answer rather than an oversight in this one.

## What the app can touch

- **The projects root is the whole world.** Every path from the file drawer and the file API is
  re-validated by `realpath` containment, so a symlink cannot lead out of the root, and the root itself
  can never be touched.
- **A project delete stays inside the root.** `DELETE /api/projects/:id` re-resolves the id through the
  allowlist, removes a real immediate-child directory recursively, and refuses a symlink or an
  ambiguous entry with `400` — it never follows a link, and the root is not its own child, so the root
  is never a target. It is refused with `409` while a turn or a terminal is live.
- **Writes never follow a symlink in the target's final segment**, and never overwrite an existing file
  on create, upload or move. The save route is the one deliberate overwrite, and it refuses a non-file
  target.
- **The terminal is a real shell**, running as whatever user started the server — the same privileges,
  no sandbox. Run Clodeck as a dedicated unprivileged user
  ([Linux server](deployment.md#linux-server) shows the account), or use the
  [Docker](deployment.md#docker) image, which already runs as `node`.
- **The agent's reach is the session's permission mode**, and it is enforced by the server rather than
  by hiding a button: the wire refuses a mode outside the four, the gate check refuses Bypass when the
  deployment or the project says so, and a project's own deny and ask rules apply in every mode —
  Bypass included ([Permission modes](configuration.md#permission-modes)).

## Secrets

Clodeck **never stores, never persists, and never invents** a credential:

- The compose deployment keeps the login password in a mounted file rather than an environment
  variable, so it stays out of `docker inspect`.
- A provider's credential is read from the server's own environment and handed to the run that asked
  for it. The browser is never told one.
- A credential written into a project's `.claude/settings.json` is readable by the agent that spends
  it ([Provider profiles](configuration.md#provider-profiles)) — the environment is where it belongs.
