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
- [ ] Do lane-e hamzaman **vāghe'an test mishavad**, na faghat az rooye code: do process, har kodām yek
      `--ticket`, va har kodām worktree-e khodash, container-e khodash va log-e khodash. (Nokte-ye
      nā-test-shode: `git worktree add`-e hamzaman rooye yek repo. Age git in rā serialize mikonad yā
      moshkeli dārad, rāh-e hal — start-e staggered, yā yek lock-e kuchak rooye host — dar hamān
      commit sabt mishavad, bā dalil.)
      **Nime-ye in test shod, nime na.** Do process-e hamzaman, har kodām yek `--ticket`, har kodām
      ticket va branch-e khodash rā bardāsht — bedoone barkhord, ke daghighan hamān chizi ast ke
      ghablan mishod. Va `git worktree add`-e hamzaman mostaghim test shod: chahār da'vā-ye hamzaman,
      se round, har lane worktree va branch-e khodash — pas na lock lāzem ast na start-e staggered, va
      parāntezi-ye bālā javāb gereft. **Nime-ye container-eš na**: in machine Docker daemon va image-e
      sākhte shode nadārad, pas har do lane rooye `Image 'sandcastle:clodeck' not found locally`
      istādan. Do lane-e vāghe'i jāy-e khodesh rā rooye host dārad, va `.sandcastle/README.md` hālā
      hamintor miguyad.
- [x] `.sandcastle/README.md` be-ruz mishavad: bakhsh-e "More than one lane at a time" az **"Not
      today"** be raftār-e sākhte-shode tabdil mishavad, bā mesāl-e dastoor — va bā in ke merge hanuz
      dasti va serial mimānad.
- [x] `npm run typecheck` and `npm test` pass.

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
→ `no ticket 999 …`; `--ticket 67 --ticket 67` → `67 was pinned twice`; `--ticket 71` while on ticket
71's own branch → `clodeck/71-parallel-ticket-pinning already exists`; `--tickets 67` → `parseArgs`
refuses the unknown option. Each exited 1 with no container touched. `--ticket 60 --ticket 61` printed
`pass 1/2 — clodeck/60-…` and then stopped at the Docker image check, which is this machine's ceiling.
Two of those processes at once is the two-lane claim: each took its own ticket and its own branch.

**`git worktree add` racing itself is fine** — that was the ticket's one unprobed assumption, and it is
probed now: four concurrent claims of exactly Sandcastle's shape (`add <path> <branch>` falling back to
`-b`), three rounds, zero failures, each lane its own worktree and branch (git 2.53 on Windows). So the
recorded repair the ticket asked for is *none*: no lock on the host, no staggered start.

**Tests:** none added, and that is a decision rather than an oversight. `.sandcastle/main.mts` and
`scripts/tickets.mjs` sit outside every workspace `tsconfig` and outside the suite — the loop's own
`nextTicket()` has never had a test, and there is no runner at the root that would reach either file.
The new behaviour is verified by running the tool, above; giving the loop a harness (a root test
workspace, and `tsconfig` coverage for `.sandcastle`) is a change of its own, not this ticket's.
