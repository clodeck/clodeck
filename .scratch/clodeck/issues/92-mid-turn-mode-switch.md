# 92: A mid-turn mode switch bites in the same turn

**What to build:** `set_permission_mode` ke dar miyān-e turn sedā zade mishavad bāyad be **har tool
request-e ba'd az khodesh**, dar hamān turn, emāl beshavad — na faqat be turn-e ba'd. Ticket 81 decision
7 hamīn rā goft, vali ticket-hā-ye 82–85 faghat mode-e SDK rā avaz kardan: hook-hā-ye clodeck (ask-e Bash
dar Ask/Accept edits, va deny-e Plan) dar zamān-e sākhte shodan-e `query()` fix mishan va bā switch
taghir nemikonand. Natije: badge-e Bypass rā neshoon midahad vali Bash hanuz modal-e approval bāz
mikonad.

**Blocked by:** None (can start immediately)

**Status:** resolved

## The bug

Ticket 81 decision 7:

> A mid-turn switch applies to **subsequent tool requests**; a parked approval is answered under the
> mode it was raised in.

Landeshode:

- `server/src/sdk/anthropic.ts:109` — `toSdkOptions` yek bār
  `const hooks = bashApprovalHooks(mode) ?? planDenialHooks(mode)` rā az `input.permissionMode` misāzad.
  Hook-hā yek closure-e sābet hastan, na yek getter.
- `server/src/sdk/anthropic.ts:99` — `setPermissionMode` faghat `query.setPermissionMode(mode)` rā sedā
  mizanad, yāni mode-e SDK.
- `server/src/ws/turn-manager.ts:280-296` — mode-e store-shode rā update mikonad va setter-e run-e fa'āl
  rā sedā mizanad; hich masiri be hook-e ghablan register-shode nadārad.

Natije barāy-e har tool request-e ba'd az switch, dar **hamān** turn:

| Switch (mid-turn) | Emrooz | Ghā'ede (README §Permission modes) |
|---|---|---|
| Ask / Accept edits → Bypass | Bash hook hanuz `ask` midahad → Bash modal; Edit/Write āzād | har call āzād (project deny/ask hanuz barāy-e and) |
| Bypass → Ask / Accept edits | hich hook register nashode → Bash āzād, bedoone modal | Bash har call miporsad |
| Plan → Ask / Accept edits / Bypass | deny hook mimānad → Edit/Write va Bash deny | Ask: Bash prompt; Accept edits: Edit/Write āzād, Bash prompt; Bypass: āzād |
| Ask / Accept edits / Bypass → Plan | hich deny hook nist → Edit/Write va Bash be `canUseTool` mirasand va modal | deny bedoone prompt |
| Ask ⇄ Accept edits | hamān Bash hook; Edit/Write ru-ye mode-e SDK | dorost (in joft kār mikonad) |

`ExitPlanMode` va `AskUserQuestion` ham az hamīn hook-hā miyāyand: turn-i ke dar Plan shoru' shode ba'd az
tark-e Plan hanuz `ExitPlanMode` rā deny mikonad, va turn-i ke mid-turn be Plan mibarad hanuz deny-e Plan
rā nagiraftast.

In bug dar spec review-e ticket 86 peydā shod; 86 raftār-e land-shode rā mostanad kard (paragraph-e *"A
mid-turn switch is not retroactive"* dar `README.md`), na va'de-ye decision 7. Vaghti in ticket land shod,
README ham bāyad bargardad.

## Desired behavior

- Har switch-e miyān-e turn be har tool request-e **ba'di** dar hamān turn emāl beshavad.
- Hook-e `PreToolUse` dar zamān-e sedā zadé shodan mode-e **fa'āl-e run** rā bekhānad, na mode-i ke
  `query()` bā ān sākhte shode. Sakhtār bā implementer ast; probe-hā-ye 81 gozāresh dādand ke hook-e
  `ask`/`deny` pish az deny/ask rule-hā va mode ejrā mishavad.
- Mode-e SDK (barāy-e Edit/Write va baghie-e tasmim-hā-ye SDK) hanuz lahze-i avaz beshavad.
- Approval-i ke ghabl az switch bāz shode, zīr-e hamān mode-i ke bāz karde javāb begirad (taghir
  nemikonad).
- Chāhār jahat-e jadval-e bālā bā hamān ghā'ede-hā-ye README ham-rāh beshavand.

## Acceptance criteria

- [x] Ask → Bypass mid-turn: Bash-e ba'd az switch bedoone modal ejrā mishavad (project deny/ask hanuz
      barāy-e and).
- [x] Bypass → Ask mid-turn: Bash-e ba'd az switch dar modal park mishavad.
- [x] Plan → Ask: Edit/Write āzād, Bash miporsad.
- [x] Plan → Bypass: Edit/Write va Bash āzād.
- [x] Ask / Accept edits / Bypass → Plan: Edit/Write va Bash bedoone `approval_request` deny mishan.
- [x] Ask → Accept edits: Edit/Write lahze-i āzād mishavad; Ask ⇄ Accept edits barāy-e Bash yek raftār
      dārand.
- [x] `ExitPlanMode` deny-e khod rā bā mode-e jāri ham-rāh mikonad; `AskUserQuestion` hanuz be modal
      miresad.
- [x] Approval-e park-shode zīr-e mode-e khodash javāb migirad.
- [x] Test-hā: unit barāy-e decision-e hook dar har mode; integration bā fake barāy-e hadāghal
      Ask → Bypass va Bypass → Ask dar hamān turn.
- [x] `README.md` §Permission modes: paragraph-e "A mid-turn switch is not retroactive" bā va'de-ye
      decision 7 jāygozin mishavad.
- [x] `npm run typecheck` and `npm test` pass.

**Out of scope:**

- Mid-turn **provider** switch — profile lock (decision 11) dast nakhorde mimānad.
- "Always allow" dar modal.
- Taghir-e jadval-e chāhār mode.

## Reference

- `.scratch/clodeck/issues/81-permission-modes-decision.md` — decision 7 va measurement 1.
- `.scratch/clodeck/issues/83-every-bash-call-asks.md`,
  `84-plan-denies-without-prompting.md`, `85-bypass-with-gates.md`.
- `server/src/sdk/anthropic.ts:99,108-135,161-218`; `server/src/ws/turn-manager.ts:280-296`.
- `README.md` §Permission modes — paragraph-i ke in ticket dorost mikonad.
- `web/src/chat/PermissionModePicker.tsx` — picker-e unlocked va badge.
