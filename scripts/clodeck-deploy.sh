#!/usr/bin/env bash
#
# The production deploy, as the server runs it.
#
# This file is the repo's **reference copy**; the copy that does the work is
# root-owned at `/usr/local/bin/clodeck-deploy`. The only request it accepts is
# `deploy <40-hex-sha>` — the commit the workflow verified — and a bare `deploy`
# (or no request at all) falls back to `origin/master`. The self-hosted runner
# passes that request as an argument; over SSH the same text arrives as
# `SSH_ORIGINAL_COMMAND` through `authorized_keys`, where the key is bound to
# this script as a forced command and cannot run anything else. Install it with
# the runbook in docs/ci-cd.md; the two copies
# must be updated together.
#
# What one deploy is:
#
#   1. fetch `origin`, reset the checkout to the named commit — or to
#      `origin/master` when none was named;
#   2. `npm ci` only when `package-lock.json` actually moved (or when this is a
#      fresh checkout with no `node_modules`);
#   3. `npm run build`;
#   4. `sudo systemctl restart clodeck`;
#   5. poll `/healthz` for up to 60 seconds, and require the commit it reports
#      to be the one just deployed.
#
# A 2xx is not health. The stamp `/healthz` reports is read from the built
# artifact at boot (docs/adr/0004-build-stamp-is-baked-at-build-time.md), so a
# process that did not restart keeps reporting the previous artifact's commit —
# and a build step that did nothing, a wrong checkout, or a server too old to
# carry a stamp all have to fail the deploy rather than pass it. Anything but
# an exact match, `unknown` included, is a failed deploy.
#
# If build, restart or the stamp check fails, it resets to the commit that was
# live before, rebuilds, restarts and exits non-zero. The rollback checks
# `previous` the same way, so a rollback that did not take is said out loud too.
# The rollback is local: GitHub's `master` still points at the bad merge commit,
# and undoing that is a manual revert PR — deliberately, so the two histories
# cannot disagree silently.
#
# It runs as `clodeck`, not root. The one privileged step is the restart, and
# `/etc/sudoers.d/clodeck-deploy` allows exactly that command. There is no idle
# gate: a restart drops live sessions, and that is accepted (see ticket 93).
#
# `npm` must be on the PATH sshd gives a non-interactive session (the distro
# package or NodeSource install is; an nvm install usually is not).

set -euo pipefail

DEPLOY_DIR="/home/clodeck/clodeck"
BRANCH="master"
SERVICE="clodeck"
HEALTH_URL="http://127.0.0.1:3001/healthz"
HEALTH_TIMEOUT=60
SYSTEMCTL="/usr/bin/systemctl"

# Two ways in, one contract. Over SSH the forced command arrives in
# SSH_ORIGINAL_COMMAND; the self-hosted runner calls this script directly, so
# the same text arrives as arguments. Either way it is parsed, never executed:
# the caller is trusted to deploy, not to choose what the deploy does.
REMOTE_COMMAND="${SSH_ORIGINAL_COMMAND:-}"
if [ -z "$REMOTE_COMMAND" ] && [ "$#" -gt 0 ]; then
  REMOTE_COMMAND="$*"
fi
EXPECTED_COMMIT=""

case "$REMOTE_COMMAND" in
  "" | deploy)
    ;;
  deploy\ *)
    candidate="${REMOTE_COMMAND#deploy }"
    if [[ "$candidate" =~ ^[0-9a-f]{40}$ ]]; then
      EXPECTED_COMMIT="$candidate"
    else
      printf '[clodeck-deploy] refusing deploy argument: %s\n' "$candidate" >&2
      exit 1
    fi
    ;;
  *)
    printf '[clodeck-deploy] refusing unexpected remote command: %s\n' "$REMOTE_COMMAND" >&2
    exit 1
    ;;
esac

log() {
  printf '[clodeck-deploy] %s\n' "$*"
}

die() {
  log "$*" >&2
  exit 1
}

# Install dependencies only when the lockfile moved between two commits — or
# when there is no `node_modules` at all, which is what a fresh checkout looks
# like. A plain reset that touches no dependency should not spend a minute
# reinstalling the world.
install_deps() {
  local from="$1" to="$2"

  if [[ ! -d node_modules ]] || ! git diff --quiet "$from" "$to" -- package-lock.json; then
    log "package-lock.json moved (or node_modules is missing): npm ci"
    npm ci
  else
    log "package-lock.json unchanged: keeping node_modules"
  fi
}

# The commit `/healthz` says it is running, or a non-zero exit when the body is
# not JSON carrying a string `build.commit` — an old server, a proxy's error
# page, or a body cut short. `jq` is not installed on the server, and `npm` (so
# `node`) is already required, so Node does the parsing.
health_commit() {
  node -e '
    const body = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const commit = body?.build?.commit;
    if (typeof commit !== "string") process.exit(1);
    process.stdout.write(commit);
  ' 2>/dev/null
}

# Restart, then wait for the app to answer with the commit this deploy built.
# `/healthz` is unauthenticated on purpose (server/src/app.ts), so this needs no
# cookie. A 2xx alone proves only that *something* is listening: the stamp is
# read at boot, so an unrestarted process answers 200 with the previous build's
# commit. The first readable answer is therefore final — waiting cannot turn a
# wrong stamp into a right one — and anything other than `expected` fails.
restart_and_wait() {
  local expected="$1"

  log "restarting $SERVICE"
  if ! sudo -n "$SYSTEMCTL" restart "$SERVICE"; then
    log "systemctl restart $SERVICE failed"
    return 1
  fi

  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  local body live
  while ((SECONDS < deadline)); do
    if body="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
      if ! live="$(printf '%s' "$body" | health_commit)"; then
        log "$HEALTH_URL answered without a readable build.commit"
        return 1
      fi
      if [[ "$live" == "$expected" ]]; then
        log "healthy: $HEALTH_URL reports ${live:0:12}"
        return 0
      fi
      log "$HEALTH_URL reports ${live:0:12}, not the deployed ${expected:0:12}"
      return 1
    fi
    sleep 2
  done

  log "$HEALTH_URL did not answer within ${HEALTH_TIMEOUT}s"
  return 1
}

# Build and bring the service up for one commit. `npm run build` covers all
# three workspaces and the shared package they import through.
build_and_restart() {
  local expected="$1"
  npm run build && restart_and_wait "$expected"
}

command -v git >/dev/null 2>&1 || die "git is not on PATH"
command -v npm >/dev/null 2>&1 || die "npm is not on PATH"
command -v node >/dev/null 2>&1 || die "node is not on PATH"
command -v curl >/dev/null 2>&1 || die "curl is not on PATH"

log "deploy requested${EXPECTED_COMMIT:+ for ${EXPECTED_COMMIT:0:12}}"
cd "$DEPLOY_DIR" || die "cannot enter $DEPLOY_DIR"
git rev-parse --git-dir >/dev/null 2>&1 || die "$DEPLOY_DIR is not a git checkout"

previous="$(git rev-parse --verify HEAD)" || die "cannot read the current commit; refusing to deploy"
log "current commit: ${previous:0:12}"

log "fetching origin"
git fetch --prune origin || die "git fetch failed"

if [[ -n "$EXPECTED_COMMIT" ]]; then
  log "resetting to verified commit ${EXPECTED_COMMIT:0:12}"
  git cat-file -e "${EXPECTED_COMMIT}^{commit}" 2>/dev/null \
    || die "verified commit ${EXPECTED_COMMIT} is not in this checkout"
  git reset --hard "$EXPECTED_COMMIT" || die "git reset --hard ${EXPECTED_COMMIT} failed"
else
  log "no commit named: resetting to origin/$BRANCH"
  git reset --hard "origin/$BRANCH" || die "git reset --hard origin/$BRANCH failed"
fi

target="$(git rev-parse --verify HEAD)" || die "cannot read the deployed commit"
if [[ -n "$EXPECTED_COMMIT" && "$target" != "$EXPECTED_COMMIT" ]]; then
  die "HEAD is ${target:0:12}, not the verified ${EXPECTED_COMMIT:0:12}; refusing to deploy"
fi

if [[ "$target" == "$previous" ]]; then
  log "already at ${target:0:12}; rebuilding and restarting anyway (force deploy)"
else
  log "deploying ${target:0:12} (was ${previous:0:12})"
fi

if install_deps "$previous" "$target" && build_and_restart "$target"; then
  log "deployed ${target:0:12}"
  exit 0
fi

# Roll back locally. Every step below is best-effort and logged: the point is to
# leave the previous commit built and running, not to stop at the first error
# and leave production half-up.
log "DEPLOY FAILED — rolling back to ${previous:0:12}"
git reset --hard "$previous" || die "rollback reset failed; production needs a human"
# Unconditional, unlike the forward path: a failed forward `npm ci` can leave
# `node_modules` half-written, and the rollback's job is a tree that builds.
npm ci || log "rollback: npm ci failed"
npm run build || log "rollback: build failed"
restart_and_wait "$previous" || log "rollback: restart or health check failed"
die "deploy of ${target:0:12} failed; rolled back to ${previous:0:12}"
