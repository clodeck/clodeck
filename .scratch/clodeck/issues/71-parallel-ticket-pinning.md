# 71: The loop can be pinned to one ticket, so two lanes can run at once

**What to build:** `npm run sandcastle` hamishe yek lane-e sequential ast: `nextTicket()` avalin
ticket-e ready ke branch-esh vojood nadārad rā bar midārad, va hich chizi in entekhāb rā serialize
nemikonad. Do process-e hamzaman **hamān** ticket rā bar midārand: dovvomi yā rooye
`Branch '…' is already checked out in worktree …` mimirad, yā — bad-tar, chon sāmmt-e — worktree-e
clean rā reuse mikonad va dovvomin agent rā mirizad too hamān file-hā.

In ticket yek rāh-e sāde ezāfe mikonad: **ticket rā az voroodi begir**. Yāni
`npm run sandcastle -- --ticket 67` faghat hamān ticket rā kar mikonad va digar nemigardad. Chand lane =
chand process, har kodām yek `--ticket`. In ticket khodesh lane-hā rā ejrā nemikonad — faghat emkānesh
rā misāzad.

Mahdudiat-e asli ham infra nist: container name-hā (`sandcastle-<uuid>`), worktree-hā
(`.sandcastle/worktrees/<branch>`) va log file-hā (`<branch>-<agent>.log`) az ghabl per-run yā per-branch
hastan. Tanhā chizi ke moshtarak ast, **entekhāb-e ticket** ast — va hamān yek chiz-i ast ke in ticket
dorost mikone.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `npm run sandcastle -- --ticket <ID>` faghat hamān ticket rā kar mikonad — az hamān tracker-e
      repo (`.scratch/clodeck/issues/`) va bā hamān ghā'ede-ye ready budan: `**Status:** ready-for-agent`
      va hame-ye `**Blocked by:**`-hā `resolved`.
- [x] Darkhāst-i ke rad mishavad **bā dalil** rad mishavad, na bā yek gardesh-e khāmoosh be ticket-e
      ba'di: ticket-e ready-nist dalil-e khode tracker rā miguyad (`63 is blocked by 60, 61, 62`), va
      ID-i ke vojood nadārad ham hamintor.
- [x] Age branch-e ān ticket az ghabl vojood dāshte bāshad, run **qāte'** mishavad bā yek message-e
      roshan. (Emrooz `nextTicket()` skip mikonad va be ba'di miravad; dar hāl-e pin, "skip" yani "hich
      kāri nakon", va in daghighan hamān chiz-i ast ke bāyad sedā bezanad.)
- [x] Hich container-i sākhte nemishavad vaghti dar-khāst rad mishavad: entekhāb va validate **rooye
      host** anjām mishavad, pish az `createSandbox()`.
- [x] Bedoone `--ticket` raftār-e emrooz **bitaghir** mimānad: gardesh-e sequential, va `MAX_TICKETS`
      hamchonān saghf-e yek run.
- [x] Bā `--ticket`, `MAX_TICKETS` digar entekhāb rā mahdud nemikonad — operator khodesh gofte chi kār
      beshavad. Chand `--ticket` dar yek dastoor, be tartib-e dāde-shode.
- [x] Do lane-e hamzaman **vāghe'an test mishavad**, na faghat az rooye code: do process, har kodām yek
      `--ticket`, va har kodām worktree-e khodash, container-e khodash va log-e khodash. (Nokte-ye
      nā-test-shode: `git worktree add`-e hamzaman rooye yek repo. Age git in rā serialize mikonad yā
      moshkeli dārad, rāh-e hal — start-e staggered, yā yek lock-e kuchak rooye host — dar hamān
      commit sabt mishavad, bā dalil.)
- [x] `.sandcastle/README.md` be-ruz mishavad: bakhsh-e "More than one lane at a time" az **"Not
      today"** be raftār-e sākhte-shode tabdil mishavad, bā mesāl-e dastoor — va bā in ke merge hanuz
      dasti va serial mimānad.
- [x] `npm run typecheck` and `npm test` pass.

**Bullet 7 was run in half, and the half that ran is the half the bullet was worried about.** Two
processes at once, each a `--ticket`, each taking its own ticket and its own branch with no collision —
which is the part that used to fail. And `git worktree add` racing itself, the parenthetical's
unprobed point, was probed directly:

```sh
for lane in a b c d; do
  ( git worktree add .sandcastle/worktrees/lane-$lane test/lane-$lane 2>/dev/null \
    || git worktree add -b test/lane-$lane .sandcastle/worktrees/lane-$lane HEAD ) &
done
wait
```

Four concurrent claims of exactly Sandcastle's shape, three rounds, zero failures, every lane its own
worktree and branch (git 2.53 on Windows). **So the repair the bullet asked to be recorded is none**:
no lock on the host, no staggered start, and nothing in this ticket needs one. The evidence is the
command above rather than a script, because it belongs to the probe and not to the loop.

**The other half did not run.** This machine has no Docker daemon and no built image, so both lanes
stopped at `Image 'sandcastle:clodeck' not found locally` — no container, no worktree and no log from a
real pass was ever seen. That is the operator's first two-lane pair, on the machine that hosts the
loop, and `.sandcastle/README.md` says so in the section this ticket rewrote.

**That half ran on 2026-10-15, on the machine that hosts the loop** — the Docker daemon and the built
image the paragraph above lacked. Two processes, each with its own `--ticket`: `63` started at
`14:42:23Z` and `67` at `14:42:50Z`, twenty-seven seconds apart, which is two processes rather than one
working a pin list in order. Each held its own worktree for as long as it ran — `.sandcastle/worktrees/
clodeck-63-docs-catch-up` and `…/clodeck-67-provider-seam-per-run` were both in `git worktree list` at
the same moment — and each wrote its own log. The pair was run again that evening with 65 and 68.
Nothing needed the fallback the parenthetical named: no lock on the host, no staggered start.

**Landed as:** `--ticket <ID>`, repeatable and worked in the order given, parsed with `parseArgs` —
strict, so an argument nobody knows stops the run rather than quietly turning a pin into a queue drain.
Three pieces, all of them on the host before any container exists:

1. **`scripts/tickets.mjs ready <ID>`** — the tracker's fourth command. The readiness rule moved into
   one `whyNotReady(ticket, status)`, which `list` and `ready` now share, so the reason a pinned ticket
   is refused is the same string `list` would have printed as a skip: `63 is blocked by 60, 61, 62`,
   `no ticket 999 under .scratch/clodeck/issues`, `47 is resolved`. `list`'s own output is unchanged —
   resolved tickets stay out of its stderr, as before.
2. **`pinnedQueue()`** in `main.mts` — resolves every named id through that verdict, then checks
   `branchExists()`. A branch that already exists is a refusal rather than the unpinned loop's skip,
   because a pin has nowhere to go and Sandcastle, finding that branch's worktree clean, reuses it
   ("Reusing existing worktree at …", `dist/chunk-VOG34SRF.js`). Naming one ticket twice is refused for
   the same reason. The refusal prints to stderr and exits 1; nothing is created, and no ticket is
   silently substituted.
3. **`passTicket()`** — a pinned run shifts from the list it was handed; an unpinned run still calls
   `nextTicket()` at the start of every pass, which is how it notices the branch the previous pass
   created. `passes` is the pin count or `MAX_TICKETS`, read before the first shift, so a pinned run
   prints `pass 1/2` and `MAX_TICKETS` stops being a cap on it.

**Verified by running, not by reading:** `--ticket 63` → `63 is blocked by 60, 61, 62`; `--ticket 999`
→ `no ticket 999 …`; `--ticket 67 --ticket 67` → `67 was pinned twice`; `--tickets 67` → `Unknown
option '--tickets'`. Each exited 1 with no container touched. `--ticket 71` while on ticket 71's own
branch → `clodeck/71-parallel-ticket-pinning already exists — merge or delete it first`, which the same
command answers as `71 is resolved` now that this ticket is closed: readiness is asked first, because a
ticket with nothing left to do is refused for *that*. `--ticket 60 --ticket 61` printed `pass 1/2 —
clodeck/60-…` — the pin count, not `MAX_TICKETS` — and then stopped at the Docker image check, which is
this machine's ceiling.

**Tests:** none added, and that is a decision rather than an oversight. `.sandcastle/main.mts` and
`scripts/tickets.mjs` sit outside every workspace `tsconfig` and outside the suite — the loop's own
`nextTicket()` has never had a test, and there is no runner at the root that would reach either file.
The new behaviour is verified by running the tool, above; giving the loop a harness (a root test
workspace, and `tsconfig` coverage for `.sandcastle`) is a change of its own, not this ticket's.

## Code review

Two axes over the branch — `.sandcastle/CODING_STANDARDS.md` plus the Fowler smell baseline, and this
ticket as the spec. Four fixes, four declines:

1. **Fixed — three names that hid their payloads.** `pinnedTickets()` returned ids, `pinnedTicket()`
   returned a verdict and `pinnedQueue()` returned tickets, with `const pinned = pinnedQueue(…)` holding
   a queue rather than a pin: three near-identical names for three different things. The per-id resolver
   is folded into `pinnedQueue` (one place that builds a refusal, one union), the argv reader is
   `requestedTicketIds()`, and the call site is `claim`. Behaviour unchanged; every refusal below was
   re-run afterwards.
2. **Fixed — the reason a branch is refused existed twice**, once inside `nextTicket()`'s skip line and
   once in the pinned refusal, differing only by prefix. One `branchTaken(branch)` builds it, because
   the two are the same fact said to two audiences.
3. **Fixed — a typo'd flag answered with a stack trace.** `--tickets 67` died on an unhandled
   `ERR_PARSE_ARGS_UNKNOWN_OPTION`; it now prints Node's own sentence (`Unknown option '--tickets'`) and
   exits 1, like every other refusal here.
4. **Fixed — a ternary where the file's idiom is `if (… return …)`**, and four fields of the verdict
   re-narrowed by hand in `main.mts` where `const ticket: Ticket = verdict` says it once: the verdict
   *is* the ticket.
5. **Declined — no unit tests** (the Standards axis's one hard finding). Both files sit outside every
   `tsconfig` and outside `npm test`, so a test needs a root runner and the tracker's `ISSUES_DIR`
   injectable before there is anywhere to put it; the ticket's own acceptance for this behaviour is the
   two-lane run, which is what ran. Worth its own ticket: a root runner, and `ISSUES_DIR` as a
   parameter, before there is anywhere for such a test to live.
6. **Declined — a host lock against two lanes pinned to the same ticket.** The branch check is answered
   per process, so two lanes aimed at one ticket both pass it and then share that branch's worktree and
   log. Real, and the README now says so in the section this ticket rewrote. A lock was rejected here
   because it is not what this ticket was about — its lock was the fallback for the `git worktree`
   race, which turned out to need nothing — and because a lock file adds a stale-lock failure mode
   (a killed lane blocking a branch until someone deletes it by hand) that the loop would then have to
   reap like it reaps worktrees. Worth its own ticket if two lanes ever share a queue.
7. **Kept — the duplicate `--ticket` refusal**, which the checklist never asked for. `--ticket 65
   --ticket 65` would be two passes on one branch, which is the collision the flag exists to prevent,
   and the unpinned loop's own rule is to stop rather than redo silently.
8. **Kept — the README's "two lanes have not been run end to end yet"** paragraph. It is inside the
   section the ticket asked to be rewritten and it is the one thing an operator needs before trusting
   two lanes. The redundant "a lane never merges and never pushes" sentence beside it came out: the
   page already says that twice.
