# 68: A session runs on a profile I pick, end to end

**What to build:** Yek vertical-e kāmel: az environment tā safhe. To yek `CLODECK_PROVIDER_<NAME>_*` dar
environment-e server declare mikoni; picker kenār-e composer list-esh mikonad; yek-i rā entekhāb mikoni va
turn ru **hamān endpoint, hamān credential va hamān model** ejrā mishavad.

Profile yek **patch** ast: har zirmajmooe az se key rā mitavānad declare kone va bāghi az environment-e
server inherit mishavad — pas yek tier (mesl-e `deepseek-flash`) yek line ast. Name-e reserve-shode-ye
**default** yani "har chizi ke in server alan dārad": bā hich chiz-e declare-nashode, list faghat un rā
dārad va hich chizi dar yek run taghir nemikonad.

**Blocked by:** 67 (the run must be able to carry a provider before anything can choose one)

**Status:** resolved

- [x] Profile-hā az `CLODECK_PROVIDER_<NAME>_BASE_URL`, `_AUTH_TOKEN`, `_MODEL` miyāyand, **yek bār dar
      boot** khanānde mishavand; name normalize mishavad va list be tartib-e alfabeti bargardānde mishavad.
- [x] Yek profile mitavānad **har zirmajmooe** rā declare kone; key-hā-ye declare-nashode az environment-e
      server inherit mishavand.
- [x] **Default** reserve shode ast: "har chizi ke in server alan dārad". Bā hich chiz-e declare-nashode,
      list faghat default rā dārad va raftār-e run taghir nemikonad. Yek name ke bā `default` jang kone rad
      mishavad.
- [x] Resolution yek **trio-e kāmel** misāzad. Name-e nashenās yā stale bā yek **error-e visible** rad
      mishavad — hich vaght silent be default fallback nemikonad.
- [x] Picker **kenār-e composer** ast, profile-hā rā bā **name va model** list mikone — hich credential va
      hich endpoint — va *"running on `<profile>` · `<model>`"* rā neshoon midahad.
- [x] Entekhāb kardan va ferestādan: ān turn ru hamān endpoint, credential va model ejrā mishavad.
- [x] Picker ru **avvalin send**-e session ghofl mishavad. Surface migo **alān** chi dar hāl-e ejrā ast va
      hich vaght ede'a nemikone ke yek session *hamān* profile ast.
- [x] Yek session-e jadid dar yek project ru profile-i shoroo mishavad ke **ākharin bār dar hamān project**
      estefāde shod — remember-shode dar browser state, va bā hich chiz-e remember-nashode → **default**
      (environment-e server). *Tasmim-e user, 2026-10-15: re-pick-e dast-i dar har session-e jadid
      workflow-e cheap/strong rā mikoshad. Hanooz hich chiz ru disk neveshte nemishavad.*
- [x] Har run dar log **migo** kodām profile va kodām model estefāde shod, pas "in turn vaghean ru chi raft"
      ba'd az vāghe'e javāb-pazir ast.
- [x] **Hich chiz persist nemishavad:** na file-e jadid, na store-e jadid. Entekhāb dar client mimānad.
- [x] Client faghat name va model migirad — hich credential, va hich endpoint-i ke khodesh nemitoone
      bekhone.
- [x] `npm run typecheck` and `npm test` pass.
