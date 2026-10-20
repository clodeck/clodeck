# 82: The composer picks the mode, and the run keeps it

**What to build:** Dar har project, user az yek kontrol kenar-e provider picker yeki az **Ask**،
**Accept edits** ya **Plan** ra entekhab mikonad va hame-ye turn ba hamoon mode ejra mishavad. Entekhab
baraye **session** be yad mimanad: switch-e mid-turn baghi-ye turn ra avaz mikonad، reconnect
bargardand-esh midehad، va **New chat** be default-e server barmigardad. **Bypass** dar in ticket
pishnahad nemishe (ticket 85).

**Blocked by:** None (can start immediately)

**Status:** resolved

## Agent Brief

**Summary:** Mode az client be server miresad, dar run-e project mimanad, va be **har** `query()` dade
mishavad — bedoone in, har turn-e jadid be `'default'` barmigardad.

**Current behavior:**
- `PermissionMode` har shesh value-e SDK ra dar shared darad, vali hich code-i an ra entekhab nemikonad.
- `set_permission_mode` faghat vaghti turn dar hale ejra ast kar mikonad (`no_active_turn`).
- `SendPromptPayload` faghat `{ prompt, profile }` darad.
- Har turn yek `query()`-e jadid ast va `permissionMode` az input miayad; bedoone field, default
  `'default'` ast.
- Web hich kontrol-e mode nadarad; footer faghat provider picker ra darad.

**Desired behavior:**
- **Shared:** `SendPromptPayload` yek `permissionMode?` optional migirad (hamoon union-e shish-value).
- **Server:**
  - `CLODECK_PERMISSION_MODE` dar boot khānde mishavad. Ta ticket 85 faghat `default`, `acceptEdits`,
    `plan` ghabooland; value-e ghalat ya `bypassPermissions` boot ra ba payam-e vāzeh mishopad.
  - Wire validator `auto` va `dontAsk` ra rad mikonad; ta ticket 85 `bypassPermissions` ham rad mishavad.
  - Run-e project mode ra negah midarad: avval az payload, vagarna az mode-e zakhire-shode, vagarna az
    env default.
  - **Har** `query()` (na faghat avvalin send) mode-e mo'aser ra migirad.
  - `set_permission_mode` dar miyān-e turn: `setPermissionMode`-e run + update-e mode-e zakhire-shode.
  - Snapshot mode ra bar-migardānad; `clear_resume` / New chat be env default barmigardad.
  - Approval-e park-shode bā mode-i ke bā un raise shode javāb dāde mishavad; re-evaluate nemishavad.
- **Client:**
  - Chip-e mode kenār-e provider picker; **hamishe** mode-e mo'aser ra neshoon midahad.
  - Label-hā: `Ask`، `Accept edits`، `Plan` — na `default`.
  - Ba'd az avvalin turn **lock nemishavad** (bar khalāf-e provider).
  - Entekhāb-e idle dar `send_prompt`-e ba'di ferestāde mishavad; entekhāb-e miyān-e turn
    `set_permission_mode` miferestad.
  - Reconnect mode ra az snapshot migirad.

**Key interfaces:** `SendPromptPayload.permissionMode`; mode-e zakhire-shode dar run-e project; field-e
snapshot; `CLODECK_PERMISSION_MODE`.

**Acceptance criteria:**
- [x] Bā `Ask` send mikoni; turn bā `default` ejrā mishavad va UI ham `Ask` neshoon midahad.
- [x] Mode-e entekhāb-shode ghabl az avvalin send (vaghti hich run-i nist) be SDK miresad.
- [x] Entekhāb-e mode vaghti run idle ast, dar send-e ba'di e'māl mishavad.
- [x] Switch-e miyān-e turn rooye tool call-hā-ye ba'di asar migozārad va turn-e ba'di bā hamoon mode
      shoroo mishavad.
- [x] Reconnect mode ra az snapshot bar-migardānad; New chat be `CLODECK_PERMISSION_MODE` barmigardad.
- [x] Project switch har project mode-e run-e khodesh ra negah midārad.
- [x] `auto`، `dontAsk`، va tā ticket 85 `bypassPermissions` dar validator rad mishan.
- [x] `CLODECK_PERMISSION_MODE`-e nāmotabar boot ra bā payām-e vāzeh mishopad.
- [x] Approval-e park-shode bā mode-e raise-shode javāb dāde mishavad.
- [x] Test-hā: server (payload، store، snapshot، reset، validator); web (chip، label، switch).
- [x] `npm run typecheck` and `npm test` pass.

**Out of scope:**
- Bypass va gate-hā-ye ash (85).
- Delta-hā-ye gharārdād — har Bash asks (83)، Plan denies (84).
- "Always allow"، edit-e input-e approval، UI-e custom barā-ye `AskUserQuestion`.
