# 73: The dev loop reads `.env`

**What to build:** Yek `npm run dev:env` ke `.env` rā load mikonad va bad dev loop rā mizanad — va yek
script-e repo (`scripts/dev-env.mjs`) ke in kār rā mikonad, bedoone hich dependency-e jadid.

Mas'ale: `.env` va dev loop hich vaqt be ham nemiresidand. Wizard har chizi ke migirad rā dar `.env`
minevisad, va `start-clodeck.*` un rā be `npm run serve` miresānad — vali `npm run dev` (tanhā loop-i ke
yek developer dar un kār mikonad) hich file-i nemikhānad. Pas step 3-e README, ke migoyad faghat
`UI_PASSWORD` va `PROJECTS_ROOT` rā dasti bezan, har value-e digar-e `.env` rā **sāket** az dast midād —
va jomle-ye khode wizard, «nothing else does [read `.env`], which is what the launcher is for», dorost
bud va hamoon bug bud.

Un sāket faghat barāye credential bad ast. `UI_PASSWORD` va `PROJECTS_ROOT` az avvalin screen por-seda
shekast mikhoran (login rad mishe, sidebar khāli ast), vali credential tā **avvalin turn-e chat** hich
chizi nemigoyad — va unjā `Not logged in · Please run /login` midahad, ke payām-e khode Agent SDK ast va
be `/login`-e clodeck hich rabti nadārad (2026-10-16, hamin rokh dād).

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `npm run dev:env` dev loop rā bā `.env`-e load-shode bālā miāvarad; `npm run dev` va `dev:fake`
      dast-nakhorde mimānand, chon un-hā loop bā hich chizi dar jolo-e un-hāst.
- [x] **Chāhār ghāyede-i ke `.env` rā mo'ayan mikonad hamān-e ke do launcher dārand**: blank/comment/
      bi-`=` rad mishavad, jodāi ru-ye **avvalin** `=` ast, key trim mishavad, va value verbatim ast
      (faghat `\r`-e ākhar miravad). Yani un file dar se khānande yek ma'ni dārad.
- [x] Value-hā quote, `#` va backslash rā be onvān-e character negah midārand — dalil-e asli-e inke in
      file khānande dārad be jā-ye `source .env`: shell backslash-e yek path-e Windows rā mikhōrad, va
      yek secret-e darārand-e `#` az nesf boride mishavad.
- [x] `.env` bar environment-e mojood **avlaviyat** dārad (hamān kāri ke launcher-hā mikonand).
- [x] `.env`-e gom-shode loop rā shoroo nemikonad: exit code-e gheyr-sefr, do rāh-e hal dar payām, va
      bedoone stack trace.
- [x] Line-e load **faghat esm-e key-hā** rā minevisad, hich vaqt value rā — terminal-e scroll-shode jā-ye
      neveshtan-e password nist.
- [x] Test-hā: parser (comment/blank/avvalin `=`/trim/backslash/`#`/quote/CRLF), override, va masir-e
      CLI-e `.env`-e gom-shode (ke qabl az hich spawni stop mikonad, pas suite hich npm-i shoroo nemikonad).
- [x] Tooling zire har do dar-e repo ast: `tsconfig.tooling.json` (bā `checkJs`) va root runner-e
      `npm test` — hamān chizi ke ticket 72 sākht.
- [x] README.md va README.finglish.md har do update shodan.
- [x] `npm run typecheck` va `npm test` pass.

## What landed

```
package.json              "dev:env" / "dev:fake:env": node scripts/dev-env.mjs — in link-e jadid.
scripts/dev-env.mjs       parseEnvFile / withEnvFile / missingEnvFileMessage (pure), va CLI-e
                          invokedDirectly-guarded ke .env rā mikhānad va npm run <target> rā
                          bā stdio-e inherit spawn mikonad.
scripts/dev-env.test.mts  9 case: ghāyede-hā, override, va payām-e file-e gom-shode.
README.md                 step 3 (yek "…or let .env do it"), jadval-e Commands (2 row), bullet-hā-ye
                          wizard (jomle-ye "nothing else does" dorost shod), va Troubleshooting
                          (payām-e `Not logged in` be onvān-e symptom-e esm-borde).
README.finglish.md        hamān jā-hā: TL;DR, §3.3, §3.4, §5.1 (jadval-e rāh-hā se tā → chāhār tā).
```

## Decisions this ticket did not pin

- **Yek script-e repo, na yek launcher-e sevvom.** `start-clodeck.ps1` / `.sh` māl-e **machine** hastan
  (gitignored, wizard misāzad) chon `serve`-e yek deployment rā ejrā mikonand. Dev loop māl-e repo ast —
  `dev` dar `package.json`-e repo ast — pas dar-e un ham bāyad dar repo bāshad. In yek file ast, na do tā:
  launcher-hā majboor budand do zobān bāshand, in script na.
- **Parser-e dasti, na `node --env-file` va na dotenv.** `--env-file`-e Node quote rā interpret mikonad va
  `#` rā **dākhel-e value** be onvān-e comment miborad; un yek `.env` rā do ma'ni mikard — yeki barāye
  launcher-hā va yeki barāye in. Yek file, se khānande, yek ma'ni.
- **`.env` bar env-e export-shode avlaviyat dārad.** Har do launcher har nām rā bi-qeyd set mikonand, va
  in samte-e mofid ast: `.env` value-hā-ye **in** deployment ast, va yek variable-e az ghabl export-shode
  aksar awqāt yādghār-e yek dastoor-e qabli ast.
- **Key trim mishavad, value na.** Yek fasele qabl az key typo ast (va `.ps1` az ghabl trim mikard); yek
  fasele dar ākhār-e password **khode password** ast.
- **`npm_execpath` barāye spawn.** npm un rā barāye har script-e ke shoroo mikonad export mikonad, pas
  `process.execPath` ru-ye un loop rā **bedoone shell** ejrā mikonad. Ru-ye Windows `npm` yani `npm.cmd`,
  Node yek `.cmd` rā bedoone shell spawn nemikonad, va shell argument-hā rā be jā-ye pass kardan
  be ham mibandad. Age kasi script rā mostaghim bā `node` ejrā konad, fallback shell migirad.
- **Yek argument-e ikhtiyāri, va `dev:fake:env`.** `dev:fake` hamān shekāf rā dārad (loop-i ast ke
  `UI_PASSWORD` va `PROJECTS_ROOT`-e `.env` rā nemibinad), pas har do script wire shodan va `dev:env`
  har target-i rā qaboul mikonad: `npm run dev:env -- dev:fake`.
- **Launcher-hā va wizard dast nakhordand.** Un-hā māl-e deployment-and va jā-ye digari dārand; in ticket
  faghat shekāf-e dev loop rā mibandad.

## Evidence

**Loader value-hā rā be child miresānad** — yek package-e sākhte dar `mktemp -d`, bā `.env`-i ke hamān
chiz-hāyi rā dārad ke sakht-and:

```
--- bytes of the .env the loader will read ---
# a comment
UI_PASSWORD=p#ss word
PROJECTS_ROOT=C:\Users\Ehsan\clodeck-projects
ANTHROPIC_AUTH_TOKEN=sk-a-value-with-#-and-\-in-it
--- FROM_SHELL is exported in the parent; .env overrides UI_PASSWORD ---
clodeck: .env → 3 values (UI_PASSWORD, PROJECTS_ROOT, ANTHROPIC_AUTH_TOKEN) · npm run echo-env
PROJECTS_ROOT=[C:\Users\Ehsan\clodeck-projects]
UI_PASSWORD=[p#ss word]
FROM_SHELL=[inherited]
```

Chāhār chiz rā nesbatan be ham neshoon midahad: backslash-e yek path-e Windows sālem mimoond, `#` va
fasele dākhel-e value character mimānand, `.env` bar `UI_PASSWORD=stale`-e export-shode **miborad**, va
baghie-ye environment (`FROM_SHELL`) dast-nakhorde pass mishavad.

**Ru-ye `.env`-e vāghe'e-ye in repo**, bā target-i ke qabl az shoroo-e hich chizi stop mikonad:

```
> clodeck@0.0.0 dev:env
> node scripts/dev-env.mjs no-such-script
clodeck: .env → 6 values (PROJECTS_ROOT, UI_PASSWORD, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, CLODECK_PROVIDER_FLASH_MODEL, CLODECK_PROVIDER_PRO_MODEL) · npm run no-such-script
npm error Missing script: "no-such-script"
exit=1
```

Har shesh value — az jomle do tāyi ke pish-tar gom mishodand — load mishavad, va exit code-e child
(`1`) be parent miresad.

**Unchi ke in ticket test nakarde:** yek turn-e vāghe'e-ye chat zire `npm run dev:env`. Do nime-ye un
jodā test shode — in file ke `.env` rā be child miresānad (bālā), va inke yek server bā credential javāb
midehad (`ok`) dar hāli ke bedoone un `Not logged in · Please run /login` midahad (jezv'e-ye tashkhis,
na in branch) — vali yek ejrā-ye vāghe'ī az `npm run dev:env` tā yek turn-e movafagh, test-e qaboul-e in
ticket ast ke bāyad bā restart-e app-e kārbar gasht.

## Further notes

- **In shekāf yek shekāf-e digar rā roushan kard.** `Anthropic API key` tanhā chizi ast ke nabudan-ash az
  avval por-seda nist: hich jā-ye clodeck (na preflight, na log-e shoroo) nemigoyad ke server aslan
  credential-i nadārad. Yek warn-e shoroo — be hamrāh-e `sent: nothing`-e turn — ān `Not logged in` rā az
  yek mo'ammā be yek jomle tabdil mikonad. Ticket-e jodā mikhad, va az in yeki kuchak-tar nist.
- `npm run dev` bā `PORT=3300`-e inline ham chenān kār mikonad; `dev:env` faghat rāh-e `.env` ast, jā-ye
  un nist.
