# CI/CD

## The branch model

Two long-lived branches, and only one of them is written by a person's push or an agent's merge:

- **`main` is integration.** Work happens on a short-lived branch (`clodeck/<ticket>-<slug>`), which is
  merged locally with `git switch main && git merge --no-ff <branch>` and then pushed. `main` has no
  strict protection: it is where a change is *known to pass* the checks.
- **`master` is production.** It moves only by a pull request **from `main`**, merged as a **merge
  commit**; branch protection allows no direct push. The merge is the deploy trigger — not a tag, not a
  release, not a button. Require-up-to-date may stay **off**, because `master` is only ever one merge
  commit ahead of `main`, so a stale base is not a real risk.
- **`npm run pr` is the publish step.** From `main` it runs `git push origin main` and
  `gh pr create --base master --head main --fill`. If a pull request from `main` is already open it
  prints that URL instead of opening a second one, and without `gh` (or without a signed-in account) it
  stops with the commands that fix it.

Agents never push, never merge into `master`, and never force-push anything. Their branch is the
deliverable; publishing production is a person's deliberate act (see [`AGENTS.md`](../AGENTS.md)).

## The checks

One composite action, [`.github/actions/verify/action.yml`](../.github/actions/verify/action.yml), is
the single list both workflows run:

```text
npm ci → node scripts/tickets.mjs check → npm run typecheck → npm test → npm run build
```

- **[`ci.yml`](../.github/workflows/ci.yml)** — on every push to `main`, every pull request targeting
  `master`, and `workflow_dispatch`. Ubuntu, Node 22, `npm ci` with the npm cache. Concurrency cancels
  a superseded run on the same ref. Its job is named `check`, and that is the required status check
  `master`'s protection points at.
- **[`deploy.yml`](../.github/workflows/deploy.yml)** — on a push to `master` and `workflow_dispatch`
  (a deliberate force-deploy). The `verify` job runs the same composite action on `master` itself, and
  only then does the `deploy` job run the root-owned deploy script on the server's self-hosted runner
  (`clodeck-prod`). Concurrency is `deploy-production` with `cancel-in-progress: false`: a running
  deploy is never cancelled, a queued one waits.
- **[`e2e.yml`](../.github/workflows/e2e.yml)** — nightly (`02:17 UTC`) and on demand. It is **not** a
  required check and does not run on pull requests: it starts `npm run dev:fake` against a temporary
  `PROJECTS_ROOT` holding `demo` and `hello`, installs Chromium, runs
  `npm run e2e -- --project=dev-pair`, and keeps the failure screenshots. A red run is a signal, not a
  gate.

Playwright itself is the same suite in both places. Locally it drives the machine's installed Chrome;
under CI (`CI` set) it drives the Chromium the workflow installs (`web/playwright.config.ts`).

## Deploying to production

The `deploy` job does not connect to the server — it **runs on the server**. A self-hosted runner
labelled `clodeck-prod` exists on that machine only, because its provider filters inbound SSH from
GitHub's runners; being on the host needs no open port, no deploy key and no host pin. The job takes
the SHA the `verify` job checked and runs the installed `/usr/local/bin/clodeck-deploy deploy
<40-hex-sha>` — a root-owned copy of [`scripts/clodeck-deploy.sh`](../scripts/clodeck-deploy.sh), this
repo's reference copy; update the two together. The script accepts exactly that one request (a bare
`deploy`, or none, falls back to `origin/master`), so the caller chooses *which commit* and never *what
runs*. The same script still works as an SSH forced command, where the request arrives as
`SSH_ORIGINAL_COMMAND` instead of arguments.

One deploy:

1. `git fetch --prune origin`, then `git reset --hard <the verified SHA>` — or `origin/master` when no
   SHA was named — in `/home/clodeck/clodeck`;
2. `npm ci` **only** when `package-lock.json` moved between the live and new commits (or when
   `node_modules` is missing);
3. `npm run build` (shared → server → web);
4. `sudo /usr/bin/systemctl restart clodeck`;
5. poll `http://127.0.0.1:3001/healthz` for up to 60 seconds.

If the build, the restart or the health check fails, it resets to the commit that was live before, runs
`npm ci` (unconditionally — a half-finished install must not survive into the rollback), rebuilds,
restarts, and exits non-zero. There is **no idle gate**: a restart drops live sessions, which is
accepted rather than engineered around.

## One-time setup

The runbook below assumes the publish machine is Windows and the server is Linux. Run it once, in
order.

### 1. `gh` on the publish machine

```powershell
winget install --id GitHub.cli
gh auth login
```

### 2. Create `master` from `main`, and protect it

```sh
git push origin main:master
```

GitHub UI → Settings → Branches → pattern `master`: require a pull request (0 approvals), required
status check **`check`**, **Require branches to be up to date off**, force-push and deletion off,
allow administrators to bypass on, and **Automatically delete head branches off** (the head is `main`,
which must survive).

### 3. The server: the script, the checkout, npm

As a sudo-capable user:

```sh
sudo install -o root -g root -m 755 \
  /home/clodeck/clodeck/scripts/clodeck-deploy.sh /usr/local/bin/clodeck-deploy

echo 'clodeck ALL=(root) NOPASSWD: /usr/bin/systemctl restart clodeck' \
  | sudo tee /etc/sudoers.d/clodeck-deploy
sudo chmod 440 /etc/sudoers.d/clodeck-deploy
sudo visudo -cf /etc/sudoers.d/clodeck-deploy

sudo -u clodeck git -C /home/clodeck/clodeck fetch origin
sudo -u clodeck git -C /home/clodeck/clodeck switch master
sudo -u clodeck git -C /home/clodeck/clodeck status -sb     # ## master...origin/master
```

The checkout must be owned by `clodeck`, and the runner below runs as `clodeck` too, so it needs `npm`
on the PATH systemd gives a non-interactive session: a distro package or NodeSource install is visible
there, while an `nvm` install usually is not, and the deploy stops with `npm is not on PATH` rather
than build with a different Node.

### 4. The server: the self-hosted runner

Take a registration token (good for one hour) and pipe
[`scripts/clodeck-runner-setup.sh`](../scripts/clodeck-runner-setup.sh) into the host; it downloads the
runner, registers it, and installs the systemd service:

```powershell
gh api -X POST repos/clodeck/clodeck/actions/runners/registration-token --jq .token
ssh root@<host> "bash -s -- <token>" < scripts/clodeck-runner-setup.sh
```

The runner carries the `clodeck-prod` label — the only label the deploy job asks for — and shows up
under **Settings → Actions → Runners** as *Idle*. Because the repository is **public**, its runner
group must allow public repositories: organization **Settings → Actions → Runner groups → Default →
Allow public repositories**. Without that, every deploy job waits for a runner that never matches.

### 5. Nothing else in GitHub

There is no deploy secret and no variable: `verify` runs on GitHub's infrastructure and hands the SHA
to the runner.

## Rollback

An automatic rollback is local to the server: it restores the previously running commit and leaves
GitHub's `master` on the bad merge commit, so the two never disagree silently. To undo the publish
itself, open a revert PR against `master` on GitHub; merging that is another deploy, of the reverted
tree.
