# The ticket loop

`.sandcastle/main.mts`, run by `npm run sandcastle`, drains this effort's tickets: **one ticket per
pass — its own branch, its own container, its own pair of agents**. The container is what buys the
clean context: every `sandbox.run()` spawns a fresh `claude`, so ticket N+1 never sees ticket N's
conversation.

A pass is two agents on one branch:

1. **implement** — one agent, `implement-prompt.md`, on `clodeck/<id>-<slug>`, closing the ticket's
   status line in the same commit as the change.
2. **review** — a second agent, `review-prompt.md`, on the same branch: the ticket's checklist against
   the diff, then clarity and correctness, applying what it finds.
3. **the branch is left behind for you.** The loop never merges and never pushes —
   `.githooks/pre-push` refusing a push from inside the container is a guarantee, where asking an
   agent not to push would only be a request.

Which ticket is next is decided **on the host**, before any container exists: `scripts/tickets.mjs`
reads `**Status:**` and `**Blocked by:**` out of `.scratch/clodeck/issues/*.md` and prints the tickets
that are `ready-for-agent` with every blocker `resolved`. A ticket whose branch already exists is
skipped — a status only reaches the host when its branch is merged, so an unmerged branch is the one
thing standing between the loop and redoing the same ticket. `--ticket` hands that choice to the
operator instead: see [More than one lane at a time](#more-than-one-lane-at-a-time).

That choice lives in **`.sandcastle/queue.mts`**, apart from `main.mts` — which reads git config and
creates a sandbox as it loads, so it cannot be imported, and nothing in it is worth a unit test. The
tracker and the branch list reach `queue.mts` as two small ports, which is what lets a test answer
both: `.sandcastle/*.test.mts` and `scripts/*.test.mts` run under `npm test`, beside the workspaces'
own suites, and `npm run typecheck` covers the same two directories (`tsconfig.tooling.json`).
`scripts/tickets.mjs` reads whatever directory it is handed — every function there takes one, and
`CLODECK_ISSUES_DIR` moves the default for the command line too — which is how a test drives it over a
fixture directory instead of over this effort's own tickets.

`MAX_TICKETS` in `main.mts` caps a single run at six passes, when nobody pinned one. Each pass is a
container, an `npm ci` and two agents, so that constant is the dial that decides what a run costs.

## Setting the loop up on another machine

The loop runs on the host; only the agents run in the container. That is what splits the work in two.

**Before you clone.** The loop reads the clone it is run from, and a clone is only as good as the
remote it came from: `git status -sb` must say `## main...origin/main` with nothing ahead of it. A
push left for later is work the new machine does not have.

**On the host** — the clone, the toolchain, and the container runtime:

| What | Why |
|---|---|
| The repo, **in a directory named `clodeck`** | The image's name comes from the repo directory's name (`sandcastle:clodeck`) and the loop looks that image up at run time. A clone in `clodeck-loop/` looks for `sandcastle:clodeck-loop` and finds nothing. |
| Node ≥ 22.12, plus `python3 make g++` | The host runs the loop itself under `tsx`, so it needs `node_modules` — and on Linux `npm ci` compiles `node-pty`. The image carries the same toolchain for the same reason. |
| Docker, and your user in the `docker` group | Every pass is a container. |
| `git config user.name` and `user.email` | `main.mts` reads both from the host's git config and refuses to start without them: the image ships no gitconfig, so the agent could not commit at all. |
| **`.sandcastle/.env`** | Gitignored, so a clone has none. See below — this is the step that fails quietly. |

`.sandcastle/.env` forwards **only the keys that appear in it**. A key that exists in the host's
environment alone is *not* passed into the container, which is why the file lists the provider's three
keys explicitly and why an empty value (falling back to the host's environment) is the shape the
example uses:

```sh
ANTHROPIC_BASE_URL=…       # the gateway or the API host
ANTHROPIC_AUTH_TOKEN=…     # its token
ANTHROPIC_MODEL=…          # a model that endpoint actually serves — passed straight to `claude --model`
```

A Claude subscription or an Anthropic key instead is `CLAUDE_CODE_OAUTH_TOKEN` (from
`claude setup-token`) or `ANTHROPIC_API_KEY`, in the same file.

**The whole checklist, in order:**

```sh
git clone <this repo> clodeck && cd clodeck
npm ci
git config user.name "…" && git config user.email "…"      # if the machine has neither
cp .sandcastle/.env.example .sandcastle/.env               # then fill in the provider's keys
npx sandcastle docker build-image                          # once, and again after any Dockerfile change
npm run sandcastle
```

**Build the image as the user who will run the loop.** On Linux and macOS
`sandcastle docker build-image` passes `--build-arg AGENT_UID=$(id -u)` — the container's `agent` is
your uid, so files it writes into the bind-mounted worktree are yours — and the provider checks that
match at run time. A build under `sudo` and a run under your own account is a uid mismatch, and the
error names it: `UID mismatch: image … was built with UID 0, but the expected UID is 1000`.

**Keep this clone for the loop.** Two things read the host's checked-out branch: the review agent's
diff base (the built-in `TARGET_BRANCH` is whatever branch the host has checked out) and
`git worktree add`, which branches each new ticket off `HEAD`. Leave the clone on `main`, and do the
interactive work — a dev server, `npm run dev`, a stray `git switch` — in a second clone. That is also
what makes it reasonable to run the loop on a machine you are not editing on: nothing about it needs
your attention while it runs, and a machine with more cores to spare is exactly the machine to give it.

**A Linux host is the faster one.** The Windows-specific repairs in `main.mts` were mostly about the
bind mount crossing a Windows drive — the ~100× inflation of each test file's first run, and
`node_modules` symlinks Linux made and Windows could not delete back. On a native filesystem those
become no-ops (`core.autocrlf` is unset, so it is not passed in at all) and the install and the suite
simply run at their own speed.

## More than one lane at a time

Two lanes are two processes, each told which ticket it works on:

```sh
npm run sandcastle -- --ticket 67      # one shell
npm run sandcastle -- --ticket 65      # a second shell, a second lane
```

`--ticket` may be repeated, and the tickets are worked in the order given. A pinned run starts only the
tickets it was given, and `MAX_TICKETS` has nothing to say about it — the list is the cap, and the
operator is the one who decided what the run costs.

**Each lane needs a different ticket.** The branch check below is answered per process, against what
exists at that moment, so two lanes aimed at the same ticket both pass it, and then share that
branch's worktree and its log file. Nothing stops that but aiming the lanes apart.

The ticket *choice* is where two lanes used to collide, so a pinned run answers it **on the host,
before any container exists**, and refuses rather than improvising:

- a ticket the queue holds back is refused with the tracker's own reason — `63 is blocked by 60, 61,
  62` — and an id that names no ticket with `no ticket 999 under .scratch/clodeck/issues`;
- a ticket pinned twice is refused: one ticket is one branch;
- **a ticket whose branch already exists ends the run** instead of being skipped. The unpinned loop
  skips it and takes the next ticket, but a pin has nowhere to go — and Sandcastle, finding that
  branch's worktree clean, would reuse it and put this pass's agent into whatever is already there.

Nothing else is shared. Containers are named `sandcastle-<uuid>`, worktrees are per-branch
(`.sandcastle/worktrees/clodeck-67-provider-seam-per-run`) and the logs are named after the branch too
(`.sandcastle/logs/clodeck-67-provider-seam-per-run-implement-67.log`). The one thing two lanes do
share is the repository they branch from, and `git worktree add` racing itself there turns out to be
safe: four concurrent claims of exactly that shape, three rounds, and every lane came back with its
own worktree and its own branch — so there is no lock and no staggered start.

**Two lanes have not been run end to end yet.** The flag is new, and the first pair belongs on the
machine that will host the loop rather than on a laptop. The host-side half is checked — the refusals
above were run, and the worktree race was probed on its own — and the container half is per-lane by
construction.

Budget for it as a resource decision rather than a correctness one: each lane is a container, an
`npm ci` and two agents, and two or three at once is comfortable on a server. **The merges stay yours,
one branch at a time, `--no-ff`, and that is the real cost** — the more lanes, the longer the queue of
branches waiting to be read and merged.

**The tracker limits parallelism more than the infra does.** A `**Blocked by:**` chain is serial by
construction — 67 → 68 → 69 → 70 cannot overlap — and two tickets can look independent while still
colliding in a merge. The tracker is also looser than it reads: it takes only the ids *before the first
parenthesis* on a `Blocked by:` line, so a ticket whose prose says it needs another one can still be
printed as ready. Pick lanes from different parts of the codebase, and read the tickets rather than
trusting the queue's shape.

## When a pass commits nothing

Every way this setup can fail silently has one symptom — *the agent started and then did nothing* — and
`main.mts` carries the repair for each one next to the reason for it: the hooks copied out of the
worktree (a CRLF shebang is not executable, and the failure names a file that is sitting right there),
`core.autocrlf` and `safe.directory` (a Linux container inherits neither from Git for Windows), the
author identity, the model argument (`claudeCode()` always emits `--model`, so an argument-less call
emits `--model undefined`), and clearing `node_modules` from inside the container before `close()`.

So when a pass produces no commits, read `.sandcastle/logs/` for that run first, then check in this
order: is `claude` on PATH in the image, are the provider's keys in `.sandcastle/.env`, did a real
model reach `claudeCode()`, was the worktree left dirty by its own setup, and can the container's git
commit at all.
