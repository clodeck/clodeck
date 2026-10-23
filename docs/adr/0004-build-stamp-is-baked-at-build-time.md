# The build stamp is baked at build time, not read at boot

**Status:** accepted (2026-10-23). Serves the decision that the UI shows which commit is running,
recorded in `.scratch/clodeck/issues/94-build-stamp-in-the-ui.md`.

## Context

The question the operator asks after a merge is *"is the thing serving me the commit I just merged?"*
It sounds like it has one obvious answer — ask git — and it has three: read the checkout at boot, bake
the answer into the build, or have the deploy write it down.

They are not the same question. **"Which checkout is this?"** and **"which build is this?"** diverge
exactly when it matters: a `git pull` with no rebuild, a deploy whose build step silently did nothing,
and a restart that never happened. In each case a checkout tells the truth and the running code does
not.

## Decision

`npm run build` writes the stamp — the commit, the build time, and whether the tree was dirty — into
the built server artifact. The server reads it once at boot from the artifact beside its own code and
serves it at `/healthz`. The app receives the stamp as configuration, the same way it receives the web
root: the HTTP layer never reaches for git or for a file.

## Why not read the checkout at boot

- **The image has no repository.** The Dockerfile copies an explicit list of sources; `.git` is never
  in the build context. A boot-time `git rev-parse` cannot work on one of the two supported deployment
  routes.
- **It answers a different question.** After a `git pull` without a build, it reports code that was
  never compiled. The stamp is meant to be the thing that cannot lie that way.
- **It splits the fact in two.** The artifact that is running would have no record of its own origin;
  the record would live in the checkout the process happens to be next to.

## Why not have the deploy write it

It records what the deploy *intended*, not what was built — the two differ precisely in the failure
this feature exists to catch. It also weds the feature to two copies of a root-owned script plus a
runbook, and a stamp that lives in the environment is a stamp that survives a rollback's rebuild
without being rewritten.

## Consequences

- **Docker builds report `unknown`** unless the operator passes `CLODECK_BUILD_COMMIT` as a build arg.
  `unknown` is shown, never hidden: a hidden stamp is the lie the feature exists to prevent.
- **The dev loop reports `dev`**, with no build time. There is no build; saying so is the honest answer.
- **The deploy can now assert.** Because the stamp is read at boot from the artifact, a process that
  failed to restart serves the *previous* artifact's stamp. Comparing it to the deployed commit
  (ticket 95) is therefore a real check, not a tautology.
- **Rollback needs no extra step.** The rollback path rebuilds, and a rebuild rewrites the stamp.
- **`status` must stay the first key** of `/healthz`: two setup scripts match the response with
  `grep -q '"status":"ok"'`, and a reordered payload would read as a dead server.

## Considered options

- **Read the checkout at boot.** Rejected: no `.git` in the image, and it reports the checkout rather
  than the build in exactly the cases the stamp is for.
- **Have the deploy write an environment variable or a file.** Rejected: it records intent rather than
  the build, and couples the feature to the root-owned copy of the deploy script.
- **Bake it into the client bundle only.** Rejected: the client and the server are built in one
  `npm run build`, so it would show the same commit — but the deploy script could not read it, and the
  check in ticket 95 needs a fact the server answers.
- **Have the client compare against GitHub.** Rejected as scope: it needs network, a token and a
  rate-limit budget to answer a question the commit already answers for a human with a compare link.
