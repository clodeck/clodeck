# 83: Every Bash call asks

**What to build:** Dar **Ask** va **Accept edits**, har call-e Bash — `ls`, `git status`, `mkdir`, `rm`,
`sed` — dar modal-e approval park mishavad, na inke khāmoosh ejrā she. Read/Glob/Grep āzād mimānand; dar
Accept edits, Edit/Write ham āzād ast. Yek **allow** rule-e project nemitavānad in prompt rā skip kone;
**deny** va **ask** rule-hā-ye project hanuz barande-and.

**Blocked by:** 82

**Status:** resolved

## Agent Brief

**Summary:** Yek `PreToolUse` hook-e per-run bā `permissionDecision: 'ask'` har Bash rā be `canUseTool`
mifarstad. Hook ghabl az deny/ask rules va mode ejrā mishavad, pas allow rule-e project nemitavānad az
ān rad she. In mekānism ru-ye SDK-e nasb-shode probe shode ast.

**Current behavior:**
- Dar `default`, Bash-hā-ye read-only (`ls`, `git status`) bedoone soal ejrā mishan.
- Dar `acceptEdits`, `mkdir/touch/rm/rmdir/mv/cp/sed` bedoone soal ejrā mishan.
- Allow rule-e project ghabl az mode ejrā mishavad.
- `allowedTools: ['Read','Glob','Grep']` faghat read-hā rā pre-approve mikonad.

**Desired behavior:**
- Har run yek hook-e `PreToolUse` migirad ke faghat barā-ye `Bash` `permissionDecision: 'ask'` bar
  migardānad, bā yek `permissionDecisionReason`-e kootāh.
- Hook faghat dar `default` va `acceptEdits` register mishavad; dar `plan` (84) va `bypass` (85) register
  nemishavad.
- Dalil-e hook (`decisionReason`) dar approval request be client beresad va dar modal dide she.
- Read/Glob/Grep hich vaght be hook yā `canUseTool` naresand.
- `AskUserQuestion` dast-nakhorde mimānad (harzā be modal miresad).

**Acceptance criteria:**
- [x] Dar Ask, `ls` va `git status` dar modal park mishan; allow → ejrā.
- [x] Dar Accept edits, `mkdir`/`touch`/`rm`/`mv`/`cp`/`sed` park mishan; `Write`/`Edit` nemishan.
- [x] Yek `allow` rule-e project ke hamoon Bash rā match mikonad, prompt rā skip nemikonad.
- [x] Yek `deny` rule-e project ghabl az prompt deny mikonad; `ask` rule hanuz miporsad.
- [x] Read/Glob/Grep dar har do mode hich prompt-i nadārand.
- [x] Dalil-e hook dar modal dide mishavad.
- [x] Test-hā: unit barā-ye decision-e hook; integration bā fake ke yek Bash dar Ask be
      `approval_request` miresad va bā allow ejrā mishavad.
- [x] `npm run typecheck` and `npm test` pass.

**Out of scope:**
- Plan (84), Bypass (85).
- Tool-hā-ye digar (WebFetch, WebSearch, MCP) — in ticket faghat `Bash` rā pin mikonad.
