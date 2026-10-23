# 96: An approval can be remembered for the session — Bash only

**What to build:** Modal-e approval yek javāb-e sevvom migirad: **"Always allow Bash"**. Entekhāb-e ān,
current command rā allow mikonad va barā-ye **hamin run** (hamin session) dige hich Bash-i park nemishavad;
ta `New chat`, ta restart-e server, ta inke khod-e kārbar az badge-e kenār-e composer khāmesh konad.
Hich chiz rooye disk neveshte nemishavad.

In decision 13-e ticket 81 rā jāygozin mikonad (*"The approval modal is unchanged: Allow / Deny only"*),
va dar hamin ticket tasmim + build bā ham miyāyand, chon masir-e kārbari (`Bash` dar Ask/Accept edits
hamishe miporsad — decision 81 delta 2) bā estefāde ma'lum shod ke feshār-e ziādi ast.

**Blocked by:** None

**Status:** resolved

## The problem

Decision 81 delta 2 (ticket 83): dar **Ask** va **Accept edits**, *har* Bash call miporsad — `ls` va
`sed -i` ham. Barā-ye model-hāyi ke file-hā rā bā Bash edit mikonand (masalan `sed -i`, `cat >`), yāni
qesse-ye hamishe, Accept edits hich tafāvoti bā Ask nadārad: har call modal-e Allow/Deny bāz mikonad.

Probe-hā (2026-10-23, `@anthropic-ai/claude-agent-sdk@0.3.296` + endpoint-e DeepSeek):

| Scenario | `canUseTool` |
|---|---|
| `acceptEdits` + `Edit` | sedā nemishe |
| `acceptEdits` + `Bash` (`sed -i`, `rm -f`, `node --version`) | sedā mishe |
| `Ask` → mid-turn switch be `acceptEdits`, `Edit`-e ba'di | sedā nemishe |

Pas plumbing dorost ast; feshār az contract-e delta 2 miyāyad.

## The decision

**Yek `Allow` ke "remember" shode, run-scoped ast va faghat gate-e clodeck rā mipazhirad — na
project ask rule-hā rā.**

1. **Javaāb-e sevvom: "Always allow Bash"** — faqat ruy-e request-hāyi ke khod-e hook-e clodeck bāz
   karde. Modal hamān Allow/Deny rā dārad, be'ezāfe-ye in yek.
2. **Scope = run (session), dar hāfeze.** Bā `New chat` reset mishavad (mesl-e mode), bā project switch
   mimānad (mesl-e mode, chon run-e har project jodāst), bā restart-e server az beyn miravad. Hich file,
   hich registry, hich metadata.
3. **Faghat Bash.** Tool-hā-ye digar (`Edit`, `Write`, `AskUserQuestion`, …) dast nakhorde mimānand.
4. **Project settings hanuz tighten, never loosen.** Agar project's `permissions.ask` rule hamān Bash rā
   force kone, modal bāz mimānad — badge faghat gate-e clodeck rā khāmush karde. (`deny` rule va Plan
   barā-ye khod-e SDK-hā hamishe barande-and.)
5. **Visible and revocable.** Badge-e `Bash auto-allowed · Stop asking` (na `×`, yā yek dokme) kenār-e
   mode picker; click = off. Yek gate ke dadan-ash bedoone didan-e hālesh nabāshad, gate nist
   (decision 12's reason).

## How the code knows which gate opened the modal

Probe-e 2026-10-23:

- Hook-e clodeck (`permissionDecision: 'ask'` bā `BASH_APPROVAL_REASON`) → `canUseTool` bā
  `decisionReason === BASH_APPROVAL_REASON`.
- Project's `permissions.ask` rule → `canUseTool` bā **bedoone** `decisionReason` (va dar in version
  `matchedAskRule` ham `undefined` ast — qudrat-e `matchedAskRule` barā-ye in tasmim baste nist).

Pas predicate yek joye ast: `toolName === 'Bash' && decisionReason === BASH_APPROVAL_REASON`. In
hamān dalili ast ke modal neshoon midahad, pas client va server yek harf mizanand.

## Wire

- `ApprovalRequestPayload.canAllowBashForSession?: boolean` — server migozārad, faghat vaghti ke
  predicate-e bālā true ast.
- `ApprovalResponsePayload.allowBashForSession?: boolean` — client az dokme mindāzad; server bā
  request-e park-shode tashkhis midahad, be client etemād nemikonad.
- `SnapshotPayload.bashAllowedForSession: boolean` — hāmishe hāzer; reconnect ān rā negah midārad.
- Event-e jadid `session_allow` bā `{ bash: boolean }` — vaghti flag avaz mishavad broadcast mishavad,
  ke do socket (do tab) yek harf bezanand bedoone replay-e transcript.
- Control frame-e jadid `clear_bash_session_allow` — badge's off.

## Where

- `server/src/ws/turn-manager.ts` — `ProjectRun.bashAllowedForSession`؛ `park` jāy-e `answer` ke
  request-hā-ye predicate-dār rā bedoone park allow mikonad؛ `resolveApproval` flag rā set mikonad؛
  `clearBashSessionAllow`؛ `clearResume` reset؛ snapshot.
- `server/src/ws/client-message.ts` — `allowBashForSession` (boolean) va `clear_bash_session_allow`.
- `server/src/ws/bus.ts` — dispatch-e frame-e jadid.
- `shared/src/protocol.ts` — se field-hā va event.
- `web/src/chat/reducer.ts` — `bashAllowedForSession` dar `ChatView`؛ `fromSnapshot`; `session_allow`؛
  `runState` (conversation_reset) ān rā negah midārad.
- `web/src/chat/ChatPanel.tsx` — dokme-ye sevvom dar `ApprovalDialog`، badge، revoke.
- `web/src/chat/useChat.ts` — `clearBashSessionAllow`.

## Acceptance criteria

- [x] Request-e Bash ke hook-e clodeck bāz karde، `canAllowBashForSession: true` dārad؛ request-e
      AskUserQuestion yā request-i ke project ask rule bāz karde، nadārad.
- [x] `approval_response` bā `allowBashForSession: true` → Bash-e ba'di dar hamān turn va turn-hā-ye
      ba'd bedoone `approval_request` ejrā mishavad (`requestToolUse(...).asked === false`).
- [x] Request-i ke project ask rule bāz karde، ba'd az session-allow ham hanuz park mishavad.
- [x] `Edit`/`Write`/`AskUserQuestion` hich taghiri nemikonand.
- [x] `New chat` flag rā reset mikonad؛ `snapshot`-e ba'd `bashAllowedForSession: false` ast.
- [x] Reconnect flag rā az snapshot barāye client mibāzārad؛ `clear_bash_session_allow` ān rā khāmush
      mikonad va event-e `session_allow` broadcast mishavad.
- [x] UI: dokme-ye "Always allow Bash" faqat barāye request-e eligible؛ badge vaghti flag roshan ast؛
      click badge frame-e clear mifrestad.
- [x] Docs: `README.md` §Permission modes، `docs/configuration.md` §Permission modes، `GLOSSARY.md`
      (**Session allow**)، `AGENTS.md` permission bullet.
- [x] `npm run typecheck` and `npm test` pass.

**Out of scope:**

- "Always allow" barāye tool-hā-ye digar yā barāye yek command-e khāss (`Bash(git status:*)`).
- Persist kardan (disk/session metadata) — baraks-e decision 14-e ticket 81.
- `AskUserQuestion` rendering (decision 13).

## What landed

- `shared/src/protocol.ts` — `canAllowBashForSession` ro-ye request, `allowBashForSession` ro-ye
  response, `bashAllowedForSession` dar snapshot, event-e `session_allow`, va `clear_bash_session_allow`.
- `server/src/ws/turn-manager.ts` — `ProjectRun.bashAllowedForSession`؛ `answer()` jāy-e `park()` barāye
  call-hā-ye predicate-dār؛ `park()` offer rā migozārad؛ `resolveApproval` grant mikonad va flag-e
  control rā az javāb-e provider jodā mikonad؛ `clearBashSessionAllow`؛ reset dar `clearResume`.
- `server/src/ws/client-message.ts` + `bus.ts` — parse/dispatch-e javāb va clear.
- `server/src/testing/fake-provider.ts` — har run latch-e khod rā dārad, ta test-e "turn-e ba'd" ba
  allow-e davām-dār momken beshavad.
- `web/src/chat/{reducer,useChat,ChatPanel}.tsx` — field dar `ChatView`، `session_allow`، dokme-ye
  sevvom، badge va clear.
- Docs: `README.md`، `docs/configuration.md`، `GLOSSARY.md` (**Session allow**)، `AGENTS.md`،
  `.scratch/clodeck/spec-02-chat-transport.md` (superseded-pointer).
- Test-hā: 5 integration dar `bus.test.ts` (offer، project ask rule، reconnect، clear، New chat)،
  4 dar `web/src/chat/ChatPanel.approval.test.tsx`.
- **Verification (real SDK + real model, 2026-10-23):** yek turn dar Ask ke se Bash call dāsht
  (`sed -i`, `ls`, `sed -i`), avvalin approval bā `allowBashForSession` javāb shod → **faqat 1**
  `approval_request` resid va snapshot `bashAllowedForSession: true` bood.
