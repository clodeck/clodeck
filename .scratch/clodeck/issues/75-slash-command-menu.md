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

**Status:** resolved

- [x] `Composer` vaghti value bā `/` shoroo mishavad **va** caret hanuz dar token-e avval ast (hich
      whitespace-i type nashode) panel rā bāz mikonad — bā liste-ye kāmel, bedoone filter. `/` dar
      miyān-e jomle hich chizi bāz **nemikonad**: SDK command rā faghat az **token-e avval** dispatch
      mikonad, pas menu-i ke jā-ye digar bāz mishavad command-e nā-kār-sāz neshoon midahad.
- [x] Filter: **substring**, case-insensitive, rooye token-e ba'd az `/` — na prefix. Bā har harfi ke
      type mishavad liste tang-tar mishavad.
- [x] Har row: `/name` + description-e yek-khatti (age bāshe) + `argumentHint` (age bāshe). Description
      **ekhtelā nemikonim**: command-i ke description nadārad faghat name neshoon midahad.
- [x] Entekhāb: `/name ` dakhel-e box neveshte mishavad, caret ba'd az un, focus dar box mimānad, va
      panel baste mishavad. **Send nemishavad** — `/ask-matt` bedoone arg bi-ma'ni-ast, va ghom-e
      "box yek input-e chat ast, Enter send mikonad" (`Composer.tsx:12`) bāyad dast-nakhorde bemoond.
- [x] Keyboard-e moqe-i ke panel bāz-e: `↑`/`↓` harekat-e highlight, **Enter = entekhāb** (send
      nemikonad), `Tab` = entekhāb, `Esc` = baste shodan-e panel bedoone pāk kardan-e text.
- [x] Hint-e zir-e composer dar in hālāt dorost migoyad: tā vaghti panel bāz-e, "Enter to send" dorugh
      ast. Hint va raftār yek jā zende mimānand — hamoon dalili ke un do rā dar yek file gozāshte.
- [x] Hālāt-e "hich natije": panel bāz mimānad bā yek khatt-e `no matching command`, va Enter send-e
      ma'muli rā anjām midahad (chizi highlight nist).
- [x] Panel vaghti connection `live` nist bāz **nemishavad** — hamān ghā'ede-i ke box rā disabled
      mikonad (`ChatPanel.tsx:241`). Yek menu-i ke entekhāb mikonad vali nemifrestad, bad-tarin hālāt-e
      "chera kār nemikonad"-e.
- [x] **Manba'-e disk**: yek route-e jadid-e project-scoped (`GET /api/projects/:id/commands`), az
      template-e `registerProfileRoutes` (`server/src/profiles.ts:321-338`) va `readProjectPin`
      (`server/src/project-pin.ts:132`): `ScopedFs`, `resolveProject` barā-ye `:id` (tanhā jā-i ke yek
      id be directory tabdil mishavad), **bedoone cache** — mesl-e pin, ke har request yek bār khānde
      mishavad va dalil-ash ānjā neveshte shode (`bus.ts:171-181`).
- [x] Disk az `<project>/.claude/skills/*/SKILL.md` va `.claude/commands/**/*.md` name + description
      mikhānad. `name`-e frontmatter bar name-e directory moghaddam ast — hamān ghā'ede-i ke Claude Code
      dārad ("the directory name, or the frontmatter `name` when you set one, becomes the command you
      type"). Command-e nested dar `.claude/commands/` bā `:` namespace mishavad
      (`frontend/component.md` → `/frontend:component`).
- [x] Khandan-e disk **parent-hā rā ham** migirad — `.claude/skills/`-e har directory az project tā
      `PROJECTS_ROOT` (hargez balā-tar) — chon SDK ham hamin kār rā mikonad. `PROJECTS_ROOT` khodesh
      allowlist-e, pas containment nemishkanad.
- [x] Skill-e `user-invocable: false` dar menu **penhān** ast (Claude Code ham penhān-ash mikone), va
      `.claude/skills`-e **zir-e** cwd khānde **nemishavad**: SDK tā vaghti Claude dar un
      zir-directory kār nakarde load-ash nemikonad, pas neshoon dādan-ash yek command-e nā-kār-sāz-e.
- [x] **Manba'-e SDK ba'd az shoroo-e run**: `system`/`commands_changed` dar `shared/src/sdk.ts`
      declare mishavad, dar `server/src/sdk/mirror.ts` annotate mishavad (mirror-e compile-time pin —
      hamin chizi ke `tsc` rā vā-midārad har `<family>`-e jadid rā bebinad) va dar reducer liste rā
      **replace** mikonad, na merge: SDK migoyad "clients should REPLACE their cached command list with
      this payload".
- [x] Run-e feli ham liste-ye **authoritative**-e khod-ash rā midahad: `supportedCommands()` yek bār
      ba'd az shoroo-e run seda zade mishavad (`SdkRun` dar `server/src/sdk/provider.ts:53-59` yek
      accessor migirad) va natije be client miresad — in tanhā jā-i-st ke built-in-hā **bā description**
      miāyand, chon hich file-i rooye disk nadārand. Agar `commands_changed` dar shoroo ham push beshavad
      in call ezāfi-ast; in dar implement check mishavad.
- [x] `terminal_slash_commands` **penhān** mimānad: in command-hā (`exit`, `statusline`) be terminal-e
      mahali baste-and va docs-e khode field migoyad "Phone/remote UIs should hide these from command
      menus" — clodeck hamān remote UI-e. In **estesnā-ye "hame"**-ast, na naqz-e un.
- [x] Liste az **har do manba'** zende mimānad: route ru mount-e chat va har bār ke panel bāz mishavad
      dobāre khānde mishavad (yek skill-e nasb-shode dar miyān-e session bedoone reload peydā mishavad),
      va bāre-hā-ye SDK — ke dar snapshot-e (re)connect ham replay mishavand — liste rā jā-be-jā mikonad.
- [x] `AGENTS.md`: khatt-e MVP scope yek clause migirad barā-ye in feature, bā reference be in ticket —
      hamān ghā'ede-i ke project creation (46/47) va provider profiles (66/67-70) dāshtand.
- [x] `npm run typecheck` and `npm test` pass.
- [x] **Dar browser didam**: ru yek project-e bā `.claude/skills/` por (in repo khodesh yeki-st), `/`
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

## What landed

```
shared/src/commands.ts        `SlashCommand` — yek type-e moshtarak barā-ye har se jā-i ke yek
                              command radd mishavad: mirror-e SDK, payload-e protocol, va route-e disk.
shared/src/sdk.ts             `SDKSystemCommandsChangedMessage` + `terminal_slash_commands` rooye
                              init (mirror-e vāse-tar az SDK, mesl-e baghi).
shared/src/protocol.ts        yek kind-e jadid `commands` + `SnapshotPayload.commands?` (ghā'eb
                              vaghti run hich list-i nadāde).
server/src/discovery.ts       `canonicalRoot()` — yek accessor barā-ye tanhā reader-i ke bāyad az
                              project **bālā** beravad va ru root vāyestad.
server/src/commands.ts        route-e `GET /api/projects/:id/commands` + reader-e disk: skills,
                              `.claude/commands/**` bā `:` namespace, frontmatter (name/description/
                              argument-hint), `user-invocable: false`, parent-hā tā root, bedoone cache.
server/src/sdk/provider.ts    `SdkRun.supportedCommands()` — accessor-e jadid-e run.
server/src/sdk/{anthropic,mirror}.ts  delegate be `query.supportedCommands()`; annotate-e
                              `commands_changed` (pin-e compile-time).
server/src/ws/turn-manager.ts `listCommands()`: yek bār be azā-ye har run, broadcast-e `commands`,
                              va hame jā-ye `snapshotOf` — `clearResume` un rā ham pāk mikonad.
web/src/chat/reducer.ts       fold-e `commands`/`commands_changed`/**replace**, filter-e
                              `terminalCommands` az init, `commandsOf` (yek reader-e row-e wire).
web/src/chat/useCommands.ts   fetch-e route ru mount + har bār ke panel bāz mishavad.
web/src/chat/CommandMenu.tsx  panel (role=listbox) + `matchingCommands` (substring, alphabetical).
web/src/chat/Composer.tsx     token-e caret, filter, keyboard, insert, hint — hamān jā-i ke ghom-e
                              "Enter to send" neveshte shode.
web/src/chat/ChatPanel.tsx    entekhāb-e manba': list-e run age dāshte bāshad، varnā file-hā-ye project.
web/e2e/command-menu.spec.ts  browser spec (fixture-e khod-ash rā misāzad va pāk mikonad).
.scratch/clodeck/evidence/75-command-menu*.png  do screenshot: liste-ye disk-i va liste-ye run.
```

## Cheque-hā-i ke in pass az SDK-e vāghe'i gereft

- **`commands_changed` dar shoroo push **nemishavad**.** Yek session-e vāghe'i bā yek project-e por az
  skill: `system`/`init` miyāyad (bā `slash_commands` va `terminal_slash_commands`), vali hich
  `commands_changed`-i dar shoroo nist. Pas `supportedCommands()` **ezāfi nist** va bāyad seda zade
  beshavad — hamān soāl-i ke ticket gozāshte bood.
- **`user-invocable: false` rā khode SDK ham penhān mikonad**: skill-e hidden na dar `init.slash_commands`
  bood na dar `supportedCommands()`.
- **Parent-hā vāghe'an load mishavand**: `.claude/skills`-e directory-e pedar barā-ye run-e zir-e un
  miyāyad ("(project)").
- **`name`-e frontmatter barā-ye skill bar directory moghaddam ast** (va name-e directory mishavad
  `aliases`), vali **barā-ye command hich**: `name:` dar yek file-e `.claude/commands/` command rā
  avaz nemikonad.
- **`disable-model-invocation: true`** command rā az `/` **penhān nemikonad** (faghat az model). Pas
  in ticket faghat `user-invocable: false` rā rule-e penhān-dāri gereft.
- **Run-e vāghe'i: 70 command** (built-in + skill-hā-ye project) bā description va argumentHint;
  `/doctor`, `/color`, `/focus`, `/reload-plugins` ke dar `terminal_slash_commands` boodand **ghā'eb** —
  filter-e client ru dāde-ye vāghe'i test shode (`evidence/75-command-menu-after-run.png`).

## Decisions this ticket did not pin

- **List-e run yek kind-e jadid-e protocol-e (`commands`), na yek message-e SDK-e sākhte-shode.**
  `sdk`-type midanest ke "the SDK's message unmodified" ast; yek `system`/`commands_changed`-e
  masnu'i bā `uuid`/`session_id`-e sakhte bā un ghā'ede nemisākht. Kind-e jadid ham `tsc` rā vā-midārad
  har switch rā bebinad.
- **`SnapshotPayload.commands` ham ezāfe shod.** In list hich vaght block nabood, pas bedoone in
  reconnect un rā mindākht va menu be file-hā-ye project bar migasht. Dar `fromSnapshot` **ghabl** az
  block-hā gozāshte mishavad, tā yek `commands_changed`-e jadidtar ke dar block-hā replay mishavad
  barande bāshad.
- **Javāb-e khāli = javāb-e nadāde.** Liste-ye khāli na broadcast mishavad na dar round state
  neveshte mishavad: client har do hāl yek chi neshoon midahad (file-hā-ye project), va yek frame-e
  bi-asr har turn rā ālud nemikonad.
- **Hint dar hālāt-e "hich natije" "Enter to send" migoyad** — chon dar un hālāt Enter **vāghe'an** send
  mikonad. Ghā'ede-ye "tā vaghti panel bāz-e Enter to send dorugh ast" barā-ye hālāt-e liste dorost
  ast; ānjā ke chizi highlight nist, hint bāyad rāst begoyad, na bāyad az kalāme `Enter to send`
  farār konad.
- **`Esc` faghat barā-ye hamān token ast.** Tā vaghti box digar command-like nist (khāli shod, yā
  jomle-i shoroo shod) dismiss yā-dash nemishavad: "in `/` rā nemikhāham" na "menu rā nemikhāham".
  Pas az Esc, type kardan-e bishtar menu rā bāz **nemikonad**.
- **Yek reader barā-ye row-hā**: `commandsOf` (reducer) ham row-hā-ye wire rā michekad ham
  `useCommands` az un estefāde mikonad — na do parser-e jodā.
- **Frontmatter: subset-e koochak-e YAML** (yek `key: value` dar har line, quote-hā dar miyāyand).
  Yek value-e chand-line (block scalar) yā yek map-e nested "chizi declare nemikonad" — hamān javābi ke
  file-e bedoone frontmatter midahad: row faghat name neshoon midahad.
- **Esme-ye tekrāri: nazdiktar barande ast** (project bar root) va dar yek directory skill-hā ghabl az
  command-hā — hamān tarti-i ke khode SDK list mikinad.
- **`clear_resume` list rā ham bā transcript pāk mikonad**: liste māl-e *in* session bood va session-e
  ba'di liste-ye khod-ash rā migirad.
- **Browser spec fixture-e khod-ash rā misāzad va pāk mikonad** (`.claude/commands/zz-e2e-menu.md`) va
  "already exists" rā *ettelā* midānad na error: folder-i ke unjā bood māl-e spec nist, pas spec un rā
  ham pāk nemikonad. Project-e demo ke spec drive mikonad māl-e developer ast, na māl-e spec.
