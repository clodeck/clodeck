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

**Status:** ready-for-agent

- [ ] `npm run sandcastle -- --ticket <ID>` faghat hamān ticket rā kar mikonad — az hamān tracker-e
      repo (`.scratch/clodeck/issues/`) va bā hamān ghā'ede-ye ready budan: `**Status:** ready-for-agent`
      va hame-ye `**Blocked by:**`-hā `resolved`.
- [ ] Darkhāst-i ke rad mishavad **bā dalil** rad mishavad, na bā yek gardesh-e khāmoosh be ticket-e
      ba'di: ticket-e ready-nist dalil-e khode tracker rā miguyad (`63 is blocked by 60, 61, 62`), va
      ID-i ke vojood nadārad ham hamintor.
- [ ] Age branch-e ān ticket az ghabl vojood dāshte bāshad, run **qāte'** mishavad bā yek message-e
      roshan. (Emrooz `nextTicket()` skip mikonad va be ba'di miravad; dar hāl-e pin, "skip" yani "hich
      kāri nakon", va in daghighan hamān chiz-i ast ke bāyad sedā bezanad.)
- [ ] Hich container-i sākhte nemishavad vaghti dar-khāst rad mishavad: entekhāb va validate **rooye
      host** anjām mishavad, pish az `createSandbox()`.
- [ ] Bedoone `--ticket` raftār-e emrooz **bitaghir** mimānad: gardesh-e sequential, va `MAX_TICKETS`
      hamchonān saghf-e yek run.
- [ ] Bā `--ticket`, `MAX_TICKETS` digar entekhāb rā mahdud nemikonad — operator khodesh gofte chi kār
      beshavad. Chand `--ticket` dar yek dastoor, be tartib-e dāde-shode.
- [ ] Do lane-e hamzaman **vāghe'an test mishavad**, na faghat az rooye code: do process, har kodām yek
      `--ticket`, va har kodām worktree-e khodash, container-e khodash va log-e khodash. (Nokte-ye
      nā-test-shode: `git worktree add`-e hamzaman rooye yek repo. Age git in rā serialize mikonad yā
      moshkeli dārad, rāh-e hal — start-e staggered, yā yek lock-e kuchak rooye host — dar hamān
      commit sabt mishavad, bā dalil.)
- [ ] `.sandcastle/README.md` be-ruz mishavad: bakhsh-e "More than one lane at a time" az **"Not
      today"** be raftār-e sākhte-shode tabdil mishavad, bā mesāl-e dastoor — va bā in ke merge hanuz
      dasti va serial mimānad.
- [ ] `npm run typecheck` and `npm test` pass.
