# Clodeck

A single-user web UI that puts Claude Code behind a browser, on a dedicated server that also holds
every project directory. This glossary names the vocabulary of *getting it running and reaching it* —
the part of the product an operator meets before they ever sign in.

## Language

**Deployment**:
Making the app reachable from a browser on another machine, and keeping it that way.
_Avoid_: install, run, setup, serve

**Deployment route**:
One of the documented ways a deployment reaches a browser. Each has its own prerequisites and is
picked before the app starts.
_Avoid_: deploy mode, option, setup path

**Direct route**:
The deployment route where a browser reaches the app at a bare origin with nothing terminating TLS in
front of it. The only route whose session cookie cannot be `Secure`.
_Avoid_: direct mode, HTTP mode, insecure mode, plain mode

**Tunnelled route**:
The deployment route where the app binds loopback and a browser reaches it through an SSH port
forward. Reachable only from a machine that can hold the tunnel open.
_Avoid_: tunnel mode, SSH mode

**Public origin**:
The origin a browser reaches the app at. Not necessarily the origin the app process itself sees — a
proxy terminating TLS makes the two differ, which is why the app cannot infer it.
_Avoid_: base URL, public URL, domain, external URL
