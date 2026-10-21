# 84: Plan denies without prompting

**What to build:** Dar **Plan**, read-hā kār mikonand, vali har Edit/Write yā Bash **bedoone modal** deny
mishavad va turn edāme peydā mikonad; model payām-e deny rā mibinad va plan rā edāme midahad. Se
estesnā: `AskUserQuestion` hanuz be modal miresad; `ExitPlanMode` deny mishavad va session dar Plan
miminānad; va plan file-e SDK zir-e `~/.claude/plans/` hanuz neveshte mishavad.

**Blocked by:** 82

**Status:** resolved

## Agent Brief

**Summary:** Dar Plan, yek `PreToolUse` hook-e per-run barā-ye Edit/Write va Bash (va `ExitPlanMode`)
`permissionDecision: 'deny'` bar-migardānad. Deny bedoone `approval_request` ast va turn rā interrupt
nemikonad; model payām rā mibinad va edāme midahad. Bedoone `interrupt: true`.

**Current behavior:**
- SDK dar `plan` mode, file-edit va shell-write tools rā be `canUseTool` mifarstad — yāni **prompt**
  mishavad, na deny.
- Read/Glob/Grep āzādand.
- Neveshtan-e plan file zir-e `~/.claude/plans/` auto-approved ast va be `canUseTool` nemiresad.
- `AskUserQuestion` va `ExitPlanMode` ham be `canUseTool` mirasand.

**Desired behavior:**
- Hook dar `plan` barā-ye `Write`/`Edit`/`Bash` va `ExitPlanMode` deny midahad, bā yek payām-e kootāh ke
  beguyad plan mode fa'al ast va mode rā az chip avaz kon.
- `AskUserQuestion` az deny mostasnā shavad (clarifying question barā-ye plan mode lāzem ast).
- Neveshtan-e plan file zir-e `~/.claude/plans/` mostasnā shavad.
- Deny `interrupt` nakonad; turn bā `result`-e movafagh tamoom she.
- Hich `approval_request` barā-ye call-hā-ye deny-shode emit nashavad.

**Acceptance criteria:**
- [x] Dar Plan, `Write` va `Edit` bedoone `approval_request` deny mishan.
- [x] Dar Plan, har Bash bedoone `approval_request` deny mishavad.
- [x] Read/Glob/Grep kār mikonand.
- [x] Model deny rā mibinad va turn bā `result`-e movafagh (na error/interrupt) tamoom mishavad.
- [x] `AskUserQuestion` dar Plan hanuz modal miporsad.
- [x] `ExitPlanMode` deny mishavad va session dar Plan miminānad; mode az chip avaz mishavad.
- [x] Plan file zir-e `~/.claude/plans/` neveshte mishavad.
- [x] Test-hā: unit barā-ye har estesnā; integration bā fake ke deny `approval_request` tolid nemikonad va
      turn edāme midahad.
- [x] `npm run typecheck` and `npm test` pass.

**Out of scope:**
- Ask/Accept edits (83), Bypass (85).
- Yek flow-e jodā barā-ye tā'eed-e plan (`Approve plan`) — khārej shodan az Plan yek taghir-e mode ast.
