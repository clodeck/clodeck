# 93: CI on GitHub Actions, and a publish step from main to master

**What to build:** in har `push` be `main` va har pull request be `master` check-ha rooy-e GitHub
ejra beshan (`tickets check` + `typecheck` + `test` + `build`); va merge be `master` — ke faghat az
tarigh-e PR az `main` momken ast — production ra deploy kone. Deploy az tarigh-e yek SSH key-e
mahdood (forced command) be `clodeck@server` anjam mishe, rooy-e server build mikone, restart mikone,
va `/healthz` ra check mikone; shekast → rollback be commit-e ghabli.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## The model

- `main` = integration. Ravand-e ghabl barjast: branch (`clodeck/<id>-<slug>`) → merge-e mahalli ba
  `--no-ff` → `main` → push. `main` protection-e sakht nadarad.
- `master` = production. Faghat az tarigh-e PR az `main` jolo mire, ba darkhast-e user; merge-e oon
  deploy ast. Merge strategy = **merge commit**. Require-up-to-date off (ba merge commit, `master`
  hamishe yek merge commit az `main` jolo ast).
- PR creation: `npm run pr` — `git push origin main` + `gh pr create --base master --head main`;
  agar PR-e baz vojood dashte bashe, hamin ra chap mikone.
- Agent-ha hich vaght be `master` merge nemikonan va force-push nemikonan. Push-e branch faghat vaghti
  user begi.

## CI

- `.github/actions/verify` — yek composite action, ke `ci` va `deploy` har do az hamoon yek list
  estefade konan.
- `.github/workflows/ci.yml` — push be `main`, pull request be `master`, `workflow_dispatch`;
  ubuntu-latest, Node 22, `npm ci` ba cache; concurrency ba cancel.
- `.github/workflows/deploy.yml` — push be `master` va `workflow_dispatch` (force deploy); job-e
  `verify` rooy-e hamoon merge commit, ba'd job-e `deploy` ke SSH mizane; concurrency-e
  `deploy-production` ba `cancel-in-progress: false`.
- `.github/workflows/e2e.yml` — schedule-e shabane + `workflow_dispatch`, non-blocking, chromium;
  `dev:fake` + Vite, `PROJECTS_ROOT`-e movaghat ba `demo` va `hello`, `--project=dev-pair`.
- `web/playwright.config.ts`: dar CI chromium, mahalli hanooz `channel: 'chrome'`.

## Deploy

- `scripts/clodeck-deploy.sh` — reference copy-e script-e rooy-e server. Rooy-e server root-owned dar
  `/usr/local/bin/clodeck-deploy` nasb mishe va `authorized_keys` ba
  `command="/usr/local/bin/clodeck-deploy"` oon ra ejra mikone. Script as `clodeck` ejra mishe; faghat
  `systemctl restart clodeck` az sudoers-e NOPASSWD estefade mikone.
- Steps: fetch, `reset --hard origin/master`, `npm ci` faghat age `package-lock.json` avaz shode,
  `npm run build`, restart, poll-e `/healthz` ta 60s. Shekast → reset be commit-e ghabli, build,
  restart, exit non-zero.
- Bedoone idle-gate: restart session-ha-ye zende ra mindazad; in ghabele ghabool ast.
- `master`-e GitHub ba rollback-e server dast nakhorde mimoone; revert-e PR dasti ast.

## Setup-e dasti (dar README)

- `gh` rooy-e Windows + `gh auth login`.
- Sakht-e `master` az `main`; protection-e `master` (PR ejbari, required check, direct push mamnoo,
  admin bypass, bedoone review approval, bedoone up-to-date).
- Deploy key (ed25519), `authorized_keys` + forced command, sudoers, `/usr/local/bin/clodeck-deploy`.
- GitHub secrets/variables: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`.
- Server checkout az `main` be `master`.

### Runbook-e daghigh

`gh` rooy-e machine-e publish:

```powershell
winget install --id GitHub.cli
gh auth login
```

`master` az `main`:

```sh
git push origin main:master
```

Protection (GitHub UI → Settings → Branches → pattern `master`): PR ejbari (0 approval), required
check `check`, **Require branches to be up to date off**, force-push va deletion off, admin bypass
**on**, **Automatically delete head branches off** (head = `main` ast).

Deploy key:

```powershell
ssh-keygen -t ed25519 -f "$HOME/.ssh/clodeck_deploy" -C "clodeck deploy"   # Enter, Enter
Get-Content "$HOME/.ssh/clodeck_deploy.pub"
```

Server (as a sudo-capable user). Script ghabl az key nasb mishe, vagarna forced command peyda
nemishavad:

```sh
sudo install -o root -g root -m 755 \
  /home/clodeck/clodeck/scripts/clodeck-deploy.sh /usr/local/bin/clodeck-deploy

sudo -u clodeck mkdir -p /home/clodeck/.ssh
sudo chmod 700 /home/clodeck/.ssh
echo 'command="/usr/local/bin/clodeck-deploy",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc ssh-ed25519 AAAA…' \
  | sudo tee -a /home/clodeck/.ssh/authorized_keys
sudo chown clodeck:clodeck /home/clodeck/.ssh/authorized_keys
sudo chmod 600 /home/clodeck/.ssh/authorized_keys

echo 'clodeck ALL=(root) NOPASSWD: /usr/bin/systemctl restart clodeck' \
  | sudo tee /etc/sudoers.d/clodeck-deploy
sudo chmod 440 /etc/sudoers.d/clodeck-deploy
sudo visudo -cf /etc/sudoers.d/clodeck-deploy

sudo -u clodeck git -C /home/clodeck/clodeck fetch origin
sudo -u clodeck git -C /home/clodeck/clodeck switch master
sudo -u clodeck git -C /home/clodeck/clodeck status -sb     # ## master...origin/master
```

GitHub secrets/variables:

```powershell
Get-Content -Raw "$HOME/.ssh/clodeck_deploy" | gh secret set DEPLOY_SSH_KEY
ssh-keyscan -H <host> | gh secret set DEPLOY_KNOWN_HOSTS
gh variable set DEPLOY_HOST --body "<address>"
gh variable set DEPLOY_USER --body "clodeck"
```

`DEPLOY_KNOWN_HOSTS` yek pin ast — fingerprint ra ghabl az zakhire kardan ba
`/etc/ssh/ssh_host_ed25519_key.pub` rooy-e server moghayese kon. Server checkout bayad `git fetch` ra
bedoone terminal anjam dahad (credential helper ya read-only key); workflow terminal nadarad.

## Acceptance criteria

- [ ] Composite action-e `.github/actions/verify` har do workflow ra taghziye mikone.
- [ ] `ci.yml` rooy-e push be `main` va PR be `master` ejra mishe; required check rooy-e `master`.
- [ ] `deploy.yml` faghat ba'd az `verify` deploy mikone; force-deploy ba `workflow_dispatch`.
- [ ] `scripts/clodeck-deploy.sh` fetch/reset/build/restart/health/rollback ra anjam midahad.
- [ ] `npm run pr` `main` ra push mikone va PR-e `main → master` baz mikone (ya URL-e PR-e baz ra
      chap mikone); bedoone `gh` payam-e rahnama midahad.
- [ ] `e2e.yml` shabane + dasti ejra mishe va PR ra block nemikone.
- [ ] Playwright dar CI chromium estefade mikone, mahalli hanooz Chrome.
- [ ] README: branch model, setup-e CI/CD, deploy va rollback; Commands table.
- [ ] AGENTS.md: merge-e mahalli → `main`; publish = PR be `master`; agent hich vaght `master` merge
      ya force-push nemikone.
- [ ] `npm run typecheck` va `npm test` pass.

**Out of scope:** path-filter, staging, Dependabot, tag/release, `npm audit`/CodeQL, Docker/Caddy
production, notification-e ezafi, idle-gate.
