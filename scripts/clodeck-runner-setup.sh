#!/usr/bin/env bash
#
# Install the self-hosted GitHub Actions runner that performs the production
# deploy (see the README's "Publishing and CI/CD" section).
#
# The deploy job runs on this machine because the host's provider filters
# inbound SSH from GitHub's runners: being *on* the server needs no open port,
# no deploy key and no host pin. The runner is registered at repository level,
# carries the `clodeck-prod` label — the only label the deploy job asks for —
# and runs as `clodeck`, the user that owns the checkout, so it can run the
# root-owned `/usr/local/bin/clodeck-deploy` and its one sudo command.
#
# Run as root on the server, with a registration token from the publish machine:
#
#   gh api -X POST repos/clodeck/clodeck/actions/runners/registration-token --jq .token
#   ssh root@<host> "bash -s -- <token>" < scripts/clodeck-runner-setup.sh
#
# A token is good for one hour. Re-running this script is safe: an existing
# configuration is kept and only the service is (re)started.

set -euo pipefail

TOKEN="${1:-}"
REPO_URL="https://github.com/clodeck/clodeck"
RUNNER_USER="clodeck"
RUNNER_DIR="/home/${RUNNER_USER}/actions-runner"
RUNNER_NAME="clodeck-prod"
RUNNER_LABELS="clodeck-prod"

say() { printf '[runner] %s\n' "$*"; }
warn() { printf '[runner] WARNING: %s\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { echo "run this as root" >&2; exit 1; }
[ -n "$TOKEN" ] || { echo "usage: bash -s -- <registration-token> < $0" >&2; exit 1; }
id "$RUNNER_USER" >/dev/null 2>&1 || { echo "user ${RUNNER_USER} does not exist" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }

install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 755 "$RUNNER_DIR"

if [ -f "${RUNNER_DIR}/.runner" ]; then
  say "runner already configured in ${RUNNER_DIR}; keeping it"
else
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$VERSION" ] || { echo "could not read the latest runner version" >&2; exit 1; }

  case "$(uname -m)" in
    x86_64) ARCH="x64" ;;
    aarch64 | arm64) ARCH="arm64" ;;
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  TARBALL="actions-runner-linux-${ARCH}-${VERSION}.tar.gz"
  say "downloading ${TARBALL}"
  curl -fsSL -o "/tmp/${TARBALL}" \
    "https://github.com/actions/runner/releases/download/v${VERSION}/${TARBALL}"
  tar -xzf "/tmp/${TARBALL}" -C "$RUNNER_DIR"
  rm -f "/tmp/${TARBALL}"
  chown -R "$RUNNER_USER":"$RUNNER_USER" "$RUNNER_DIR"

  # The runner's bundled dependencies (libicu, libssl) in one step; harmless
  # when they are already present.
  "${RUNNER_DIR}/bin/installdependencies.sh" >/dev/null || warn "installdependencies.sh reported a problem"

  say "registering ${RUNNER_NAME} (labels: ${RUNNER_LABELS})"
  sudo -u "$RUNNER_USER" "${RUNNER_DIR}/config.sh" \
    --url "$REPO_URL" \
    --token "$TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS" \
    --unattended \
    --replace
fi

# One systemd service per registration, named actions.runner.<...>.service.
say "installing the service (runs as ${RUNNER_USER})"
( cd "$RUNNER_DIR" && ./svc.sh install "$RUNNER_USER" >/dev/null )
( cd "$RUNNER_DIR" && ./svc.sh start )

if sudo -u "$RUNNER_USER" bash -c 'command -v npm >/dev/null'; then
  say "npm for ${RUNNER_USER}: $(sudo -u "$RUNNER_USER" bash -c 'command -v npm')"
else
  warn "npm is NOT on ${RUNNER_USER}'s PATH — the deploy will stop with 'npm is not on PATH'"
fi

say "service status:"
systemctl --no-pager status 'actions.runner.*' 2>/dev/null | grep -E 'Loaded:|Active:' || true

cat <<'NOTE'

Next, on GitHub:
  - Settings → Actions → Runners should list `clodeck-prod` as Idle.
  - The repository is public, so the runner group must allow public
    repositories: organization Settings → Actions → Runner groups → Default →
    "Allow public repositories". Without it every deploy job waits forever.

NOTE
