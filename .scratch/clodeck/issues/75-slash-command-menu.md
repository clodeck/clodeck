# 75: The composer's `/` menu

**What to build:** Yek menu-e command dar composer: kārabar `/` mizanad, liste-ye command-hā bāz mishavad,
va bā har harfi ke type mikonad filter mishavad. Entekhāb yek command rā **dakhel-e box** minevisad
(`/name `), caret rā ba'd az un migozārad va send **nemikonad** — tā kārabar arg-e khod-ash rā bezanad va
bā Enter befrestad.

`/name` dar matn-e prompt **az ghabl ham kār mikone**: SDK command rā az prompt-string dispatch mikonad
(`shared/src/protocol.ts:90` faghat yek string-e, va server hich chizi rā dar un nemibinad). Pas in ticket
un rāh-e yek-tā-ye mojood rā **kashf-pazir** mikonad, na yek rāh-e dovom misāzad: menu hich chizi be wire-e
send ezāfe nemikonad. Chizi ke emrooz nadārim in-e ke kārabar nemidānad che command-hā-i vojood dārad va
har kodām che kār mikonad.

**Do manba'** — hich kodām tanhā kāfi nist:

- **Ghabl az shoroo-e run**: hich session-i vojood nadārad. Run **lazy**-e, bā yek masir-e tanhā:
  `startRun` (`server/src/sdk/anthropic.ts:72`) ← `provider.query` ← `sendPrompt`
  (`server/src/ws/turn-manager.ts:139`) ← `bus.ts:123`. Pas `system`/`init` hich vaght pish az avvalin
  send nemiāyad va `ChatView` hanooz `emptyView()`-e. Liste az filesystem-e project khānde mishavad.
- **Ba'd az shoroo-e run**: SDK khodesh liste-ye vāghe'i rā dārad. `Query.supportedCommands()` liste-ye
  `SlashCommand[]` rā midahad (`{name, description, argumentHint?, aliases?, builtin?}`,
  `sdk.d.ts:9431`, `:3026`) va be prompt niyāz **nadārad** — az control-initialize javāb migirad. Va
  `system`/`commands_changed` (`sdk.d.ts:3768-3774`) yek push-e kaamel-e liste ast ke **alān ham rooye
  wire ast** vali `shared/src/sdk.ts` declare-ash nakarde va reducer mindāzad-ash.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `Composer` vaghti value bā `/` shoroo mishavad **va** caret hanuz dar token-e avval ast (hich
      whitespace-i type nashode) panel rā bāz mikonad — bā liste-ye kāmel, bedoone filter. `/` dar
      miyān-e jomle hich chizi bāz **nemikonad**: SDK command rā faghat az **token-e avval** dispatch
      mikonad, pas menu-i ke jā-ye digar bāz mishavad command-e nā-kār-sāz neshoon midahad.
- [ ] Filter: **substring**, case-insensitive, rooye token-e ba'd az `/` — na prefix. Bā har harfi ke
      type mishavad liste tang-tar mishavad.
- [ ] Har row: `/name` + description-e yek-khatti (age bāshe) + `argumentHint` (age bāshe). Description
      **ekhtelā nemikonim**: command-i ke description nadārad faghat name neshoon midahad.
- [ ] Entekhāb: `/name ` dakhel-e box neveshte mishavad, caret ba'd az un, focus dar box mimānad, va
      panel baste mishavad. **Send nemishavad** — `/ask-matt` bedoone arg bi-ma'ni-ast, va ghom-e
      "box yek input-e chat ast, Enter send mikonad" (`Composer.tsx:12`) bāyad dast-nakhorde bemoond.
- [ ] Keyboard-e moqe-i ke panel bāz-e: `↑`/`↓` harekat-e highlight, **Enter = entekhāb** (send
      nemikonad), `Tab` = entekhāb, `Esc` = baste shodan-e panel bedoone pāk kardan-e text.
- [ ] Hint-e zir-e composer dar in hālāt dorost migoyad: tā vaghti panel bāz-e, "Enter to send" dorugh
      ast. Hint va raftār yek jā zende mimānand — hamoon dalili ke un do rā dar yek file gozāshte.
- [ ] Hālāt-e "hich natije": panel bāz mimānad bā yek khatt-e `no matching command`, va Enter send-e
      ma'muli rā anjām midahad (chizi highlight nist).
- [ ] Panel vaghti connection `live` nist bāz **nemishavad** — hamān ghā'ede-i ke box rā disabled
      mikonad (`ChatPanel.tsx:241`). Yek menu-i ke entekhāb mikonad vali nemifrestad, bad-tarin hālāt-e
      "chera kār nemikonad"-e.
- [ ] **Manba'-e disk**: yek route-e jadid-e project-scoped (`GET /api/projects/:id/commands`), az
      template-e `registerProfileRoutes` (`server/src/profiles.ts:321-338`) va `readProjectPin`
      (`server/src/project-pin.ts:132`): `ScopedFs`, `resolveProject` barā-ye `:id` (tanhā jā-i ke yek
      id be directory tabdil mishavad), **bedoone cache** — mesl-e pin, ke har request yek bār khānde
      mishavad va dalil-ash ānjā neveshte shode (`bus.ts:171-181`).
- [ ] Disk az `<project>/.claude/skills/*/SKILL.md` va `.claude/commands/**/*.md` name + description
      mikhānad. `name`-e frontmatter bar name-e directory moghaddam ast — hamān ghā'ede-i ke Claude Code
      dārad ("the directory name, or the frontmatter `name` when you set one, becomes the command you
      type"). Command-e nested dar `.claude/commands/` bā `:` namespace mishavad
      (`frontend/component.md` → `/frontend:component`).
- [ ] Khandan-e disk **parent-hā rā ham** migirad — `.claude/skills/`-e har directory az project tā
      `PROJECTS_ROOT` (hargez balā-tar) — chon SDK ham hamin kār rā mikonad. `PROJECTS_ROOT` khodesh
      allowlist-e, pas containment nemishkanad.
- [ ] Skill-e `user-invocable: false` dar menu **penhān** ast (Claude Code ham penhān-ash mikone), va
      `.claude/skills`-e **zir-e** cwd khānde **nemishavad**: SDK tā vaghti Claude dar un
      zir-directory kār nakarde load-ash nemikonad, pas neshoon dādan-ash yek command-e nā-kār-sāz-e.
- [ ] **Manba'-e SDK ba'd az shoroo-e run**: `system`/`commands_changed` dar `shared/src/sdk.ts`
      declare mishavad, dar `server/src/sdk/mirror.ts` annotate mishavad (mirror-e compile-time pin —
      hamin chizi ke `tsc` rā vā-midārad har `<family>`-e jadid rā bebinad) va dar reducer liste rā
      **replace** mikonad, na merge: SDK migoyad "clients should REPLACE their cached command list with
      this payload".
- [ ] Run-e feli ham liste-ye **authoritative**-e khod-ash rā midahad: `supportedCommands()` yek bār
      ba'd az shoroo-e run seda zade mishavad (`SdkRun` dar `server/src/sdk/provider.ts:53-59` yek
      accessor migirad) va natije be client miresad — in tanhā jā-i-st ke built-in-hā **bā description**
      miāyand, chon hich file-i rooye disk nadārand. Agar `commands_changed` dar shoroo ham push beshavad
      in call ezāfi-ast; in dar implement check mishavad.
- [ ] `terminal_slash_commands` **penhān** mimānad: in command-hā (`exit`, `statusline`) be terminal-e
      mahali baste-and va docs-e khode field migoyad "Phone/remote UIs should hide these from command
      menus" — clodeck hamān remote UI-e. In **estesnā-ye "hame"**-ast, na naqz-e un.
- [ ] Liste az **har do manba'** zende mimānad: route ru mount-e chat va har bār ke panel bāz mishavad
      dobāre khānde mishavad (yek skill-e nasb-shode dar miyān-e session bedoone reload peydā mishavad),
      va bāre-hā-ye SDK — ke dar snapshot-e (re)connect ham replay mishavand — liste rā jā-be-jā mikonad.
- [ ] `AGENTS.md`: khatt-e MVP scope yek clause migirad barā-ye in feature, bā reference be in ticket —
      hamān ghā'ede-i ke project creation (46/47) va provider profiles (66/67-70) dāshtand.
- [ ] `npm run typecheck` and `npm test` pass.
- [ ] **Dar browser didam**: ru yek project-e bā `.claude/skills/` por (in repo khodesh yeki-st), `/`
      liste midahad, type kardan filter mikonad, entekhāb insert mikonad, Enter entekhāb mikonad na send,
      va `Esc` panel rā mibandad.

**Out of scope (deliberate):**

- **Rooye yek chat-e kamelan khāli, built-in-hā dar menu nistand.** Ān-hā tā avvalin send peydā
  nemishavand, chon liste-ye SDK tā un lahze vojood nadārad va hich file-i rooye disk nadārand. Liste-ye
  disk-i (skill-hā va `.claude/commands`) az lahze-ye avval kāmel-e, va built-in-hā bishtar mid-session be
  kār miāyand. Jā-ye un — shoroo-e **eager**-e session (spawn-e run ru mount, `prewarm`) — yek taghir-e
  lifecycle-e vāghe'i-ast: run-e lazy ma'ni-e "New chat"-e ticket 74 rā midahad va ticket-e khod-ash rā
  mikhad.
- `/clear` va `conversation_reset`: menu in command rā **neshoon midahad** (kārabar goft hame), vali
  clodeck fram-e `conversation_reset`-e SDK rā mindāzad (`mirror.ts:43-45`, bā test-e
  `mirror.test.ts:195-205`) — pas transcript-e ghabl az `/clear` ru safhe mimānad va ru reconnect bā
  un-i ke ba'd miāyad splice mishavad. In yek bug-e mostaghel-e ke **emrooz ham** vojood dārad (dasti
  `/clear` ham hamān kār rā mikonad) va ticket **76**-e. In ticket faghat menu-i-st ke un rā rāhat-tar
  mikonad.
- Subagent-hā (`.claude/agents/*.md`) va plugin skill-hā: `AgentInfo` (`sdk.d.ts:113`) yek type-e jodā-st
  az `SlashCommand` (subagent yek command-e `/` nist), va plugin-hā dar clodeck `plugins` option
  nadārand, pas hich vaght load nemishavand.
- Command-hā-ye khode clodeck (`New chat`, `History`, provider picker) dar menu nemiāyand: ān-hā UI state
  avaz mikonand, na prompt-text, va ghati kardan-e in do ma'ni menu rā gomrāh mikonad.
- Touch/mobile: in feature keyboard-e.
