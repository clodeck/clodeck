# 85: Bypass, with its gates and its warning

**What to build:** **Bypass** ghabele entekhāb mishavad: entekhābash yek confirm dārad, va tā vaghti
fa'al ast yek badge-e dāvami dar composer dide mishavad. Agar `CLODECK_ALLOW_BYPASS` khāmoosh bāshad yā
project `permissions.disableBypassPermissionsMode: 'disable'` dāshte bāshad, Bypass rad mishavad va
dalilash neshoon dāde mishavad. Deny/ask rule-hā-ye project hanuz barande-and va warning hamoon rā
miguyad.

**Blocked by:** 83

**Status:** ready-for-agent

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
- [ ] Bypass faghat ba'd az confirm entekhāb mishavad; cancel mode-e ghabli rā negah midārad.
- [ ] Bā `CLODECK_ALLOW_BYPASS=off`, Bypass dar server rad mishavad va UI pishnahad-ash nemikonad.
- [ ] Project bā `disableBypassPermissionsMode: 'disable'` Bypass rā dar server va UI rad mikonad, bā dalil.
- [ ] Dar Bypass, yek Bash-e ādi bedoone modal ejrā mishavad.
- [ ] Yek ask rule-e project dar Bypass hanuz modal miporsad; deny rule hanuz deny mikonad.
- [ ] Switch-e miyān-e turn be Bypass kār mikonad (flag dar āghāz-e run set shode ast).
- [ ] Badge tā vaghti Bypass fa'al ast dide mishavad va bā avaz kardan nāpadid mishavad.
- [ ] Error-e root/sudo be user neshoon dāde mishavad; hich fallback-e sokooti nist.
- [ ] Test-hā: validator, env, project disable, mid-turn switch, ask-rule survival, UI confirm/badge.
- [ ] `npm run typecheck` and `npm test` pass.

**Out of scope:**
- Ask/Accept edits (83), Plan (84).
- "Remember this choice" barā-ye confirm — har entekhāb confirm-e khodesh rā dārad.
