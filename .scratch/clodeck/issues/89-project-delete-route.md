# 89: A project can be deleted through the API

**What to build:** `DELETE /api/projects/:id` ru-ye gated API, ke directory-e project rā **vāghean** va
recursive hazf mikonad. Id az khārij-e allowlist tāyid mishavad (decode hich vāght authorization nist) va
root-e khode project-hā hich vāght target nist.

Pāsox-hā: `204` bedoone body; `404` barāy-e id-i ke resolve nemishavad; `409 turn_in_progress` vaghti
run-i dar hāl-e ejrā-st — shāmel-e run-i ke shoru shode vali **hanooz session id nadāde** (pas check na
ru-ye "which session is running", bal ru-ye state-e khode run); `409 terminal_attached` vaghti terminal
manager barāy-e un project yek pty negah dāshte bāshad; `400 symlink` vaghti daghighan yek entry-e root be
id canonicalize-nashode, yā un entry-e vāhed symlink bāshad. Dar hame-ye refusal-hā hich chiz hazf
nemishavad.

Hazf ru-ye **discovery seam** mishinad (createProject ham ānjā-st, chon discovery tanhā module-i-st ke
root rā lams mikonad), na ru-ye project-scoped remove ke be mahsun-e project mahdood ast va symlink rā
arzāni unlink mikonad. Pas az hazf, **run entry** un project farāmush mishavad: id = canonical path ast,
pas hazf + sākhtan-e dobāre hamān id rā midahad, va entry-e kohne session id dārad ke send-e badi
**auto-resume** mishod. Transcript-hā-ye SDK dast nakhorde mimānanad.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `DELETE /api/projects/:id` ru-ye gated scope: `204` bedoone body, va directory az disk rāfte ast.
- [ ] Id-i ke az allowlist rad nemishavad → `404`; id-e khode root → `404`, va hich chiz birun-e root āsib
      nemibinad.
- [ ] Run-e dar-hāl-e-ejrā → `409 turn_in_progress`, chiz-i hazf nemishavad — va in shāmel-e run-i-st ke
      hanooz session nām-gozāri nakarde.
- [ ] Terminal-e attached → `409 terminal_attached`, chiz-i hazf nemishavad.
- [ ] Entry-e symlink yā id-e ambiguous → `400 symlink`, va na link va na target hazf nemishavad.
- [ ] Hazf ru-ye discovery seam piyāde shode; project-scoped remove estefāde nashode.
- [ ] Bad az hazf, run entry farāmush mishavad: hazf + sākhtan-e dobāre → awwalin send hich session id-e
      resume-shode haml nemikonad.
- [ ] Transcript-hā-ye SDK ke SDK zir-e `~/.claude/projects/<sanitized path>/` negah midārad dast-nakhorde
      mimānanad.
- [ ] Test-hā: route suite (codes va chizi ke ru-ye disk ast), discovery suite (symlink/ambiguity, root),
      bus suite (409-hā va farāmushi-e run).
- [ ] `npm run typecheck` and `npm test` pass.
