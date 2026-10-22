# 85: Bypass, with its gates and its warning

**What to build:** **Bypass** ghabele entekhāb mishavad: entekhābash yek confirm dārad, va tā vaghti
fa'al ast yek badge-e dāvami dar composer dide mishavad. Agar `CLODECK_ALLOW_BYPASS` khāmoosh bāshad yā
project `permissions.disableBypassPermissionsMode: 'disable'` dāshte bāshad, Bypass rad mishavad va
dalilash neshoon dāde mishavad. Deny/ask rule-hā-ye project hanuz barande-and va warning hamoon rā
miguyad.

**Blocked by:** 83

**Status:** resolved

## Agent Brief

**Summary:** `bypassPermissions` be validator va env bargardānade mishavad; flag-e SDK, env gate, gate-e
project, confirm va badge ezāfe mishavad. Bypass hich hook-e "ask" register nemikonad.

**Current behavior:**
- Ticket 82 `bypassPermissions` rā az validator va env rad mikonad.
- `allowDangerouslySkipPermissions` dar SDK options set nemishavad.
- Hich confirm, badge yā warning-i nist.

**Desired behavior:**
- **Server:**
  - `CLODECK_ALLOW_BYPASS` (default **on**) dar boot khānde mishavad.
  - `permissionMode: 'bypassPermissions'` dar validator va `CLODECK_PERMISSION_MODE` ghabool mishavad.
  - Vaghti bypass ejāze dārad, **har** run `allowDangerouslySkipPermissions: true` migirad (chon
    switch-e miyān-e turn bāyad momken bāshad). Vaghti ejāze nadārad, flag set nemishavad va server khodash
    Bypass rā bā dalil rad mikonad — na inke SDK fail kone.
  - Agar project `permissions.disableBypassPermissionsMode: 'disable'` dāshte bāshad, Bypass rad mishavad
    (server-side, na faghat UI) va dalil be client beresad.
  - Agar SDK dar asl-e run Bypass rā rad kone (root/sudo biroun-e sandbox), turn bā yek error-e vāzeh
    fail mishavad; mode be-sokoot be mode-e dige fallback nemikonad.
- **Client:**
  - Entekhāb-e Bypass yek confirm dialog bāz mikonad; cancel mode-e ghabli rā negah midārad.
  - Ta vaghti Bypass fa'al ast, chip va yek badge-e dāvami "Bypass" rā neshoon midahand.
  - Warning-e `CLODECK_ALLOW_BYPASS=off` yā project disable dalil rā neshoon midahad.
- **Warning text** (both the confirm and the docs) shāmel-e in jomle ast:
  *"Every tool runs without asking. A project's own deny/ask rules in `.claude/settings.json` will
  still apply."*

**Acceptance criteria:**
- [x] Bypass faghat ba'd az confirm entekhāb mishavad; cancel mode-e ghabli rā negah midārad.
- [x] Bā `CLODECK_ALLOW_BYPASS=off`, Bypass dar server rad mishavad va UI pishnahad-ash nemikonad.
- [x] Project bā `disableBypassPermissionsMode: 'disable'` Bypass rā dar server va UI rad mikonad, bā dalil.
- [x] Dar Bypass, yek Bash-e ādi bedoone modal ejrā mishavad.
- [x] Yek ask rule-e project dar Bypass hanuz modal miporsad; deny rule hanuz deny mikonad.
- [x] Switch-e miyān-e turn be Bypass kār mikonad (flag dar āghāz-e run set shode ast).
- [x] Badge tā vaghti Bypass fa'al ast dide mishavad va bā avaz kardan nāpadid mishavad.
- [x] Error-e root/sudo be user neshoon dāde mishavad; hich fallback-e sokooti nist.
- [x] Test-hā: validator, env, project disable, mid-turn switch, ask-rule survival, UI confirm/badge.
- [x] `npm run typecheck` and `npm test` pass.

**Out of scope:**
- Ask/Accept edits (83), Plan (84).
- "Remember this choice" barā-ye confirm — har entekhāb confirm-e khodesh rā dārad.

## What landed

- `shared/src/sdk.ts` — `bypassPermissions` joins `SELECTABLE_PERMISSION_MODES`;
  `BypassAvailability` is the one gate answer a surface renders.
- `shared/src/protocol.ts` — the snapshot carries `bypass: BypassAvailability`.
- `server/src/config.ts` — `CLODECK_ALLOW_BYPASS` (default on, unknown values fail
  shut with a warning); `CLODECK_PERMISSION_MODE=bypassPermissions` boots only when
  it is allowed.
- `server/src/project-pin.ts` — one read of `.claude/settings.json` now serves both
  the provider pin and `permissions.disableBypassPermissionsMode` (`readSettings`,
  `readProjectSettings`; `readProjectPin` stays as the pin-only door).
- `server/src/bypass.ts` — the two gates combined, with a reason each.
- `server/src/ws/bus.ts` — reads the gates per connection and per control message;
  writes them into the run.
- `server/src/ws/turn-manager.ts` — the run keeps the availability, passes
  `allowBypass` to every `query()`, refuses Bypass on send and on a mid-turn switch
  with `bypass_unavailable` (no fallback), and surfaces a thrown run's own message.
- `server/src/sdk/anthropic.ts` — `allowDangerouslySkipPermissions` on every run the
  gates allow; Bypass still registers no hook, which is what leaves the project's
  deny/ask rules in charge.
- `web/src/chat/PermissionModePicker.tsx` — the Bypass row, its confirmation, the
  refused row with its reason, and `BYPASS_WARNING`.
- `web/src/chat/ChatPanel.tsx` — the standing Bypass badge, the error title for
  `bypass_unavailable`, and a failed result's own errors on the result line.
- `web/src/chat/reducer.ts` — `bypass` in the view, read defensively from the
  snapshot (missing means not allowed).
