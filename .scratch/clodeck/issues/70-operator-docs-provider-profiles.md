# 70: The operator's docs catch up

**What to build:** README har chizi ke raftār-e jadid rā tozih midahad. In ticket **ba'd** az raftār
miyāyad: yek README ke yek flag-e nasākhte rā tozih bedahad az yek README-e kohne bad-tar ast (hamoon
dalili ke ticket 63 dāsht).

`AGENTS.md`, `GLOSSARY.md` va ADR dar ticket 66 montaghel shodand — in ticket faghat chizi-rā ezāfe
mikonad ke **vāgheiyat-e emrooz** rā tozih midahad.

**Blocked by:** 69 (it documents behaviour, all of it)

**Status:** resolved

- [x] README yek **provider profile** rā tozih midahad: naming-e `CLODECK_PROVIDER_<NAME>_*`, inke yek
      profile mitavānad har zirmajmooe rā declare kone va bāghi inherit mishavad, va inke profile-e
      reserve-shode-ye **default** environment-e khode-ye server ast — pas yek deployment-e
      dast-nakhorde taghir nemikonad.
- [x] **Ghāede-ye credential** dar yek khatt: endpoint va credential bā ham safar mikonan va model āzād
      ast — bā pointer be `docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`.
- [x] **Niyāz-e proxy** sarih neveshte shode: clodeck faghat **Anthropic Messages API** rā harf mizanad, pas
      har vendor-e digar az tarigh-e yek **translation proxy** ke operator mijari miyāyad — va inke renderer
      be chi az ān proxy vābastast (`stream_event` deltas, `tool_use`, `can_use_tool` approvals, `result`).
- [x] README migo picker **kojā** ast (kenār-e composer), inke entekhāb **per session** ast, va inke ba'd az
      avvalin send ghofl mishavad.
- [x] README migo credential-i ke dast-nevesht dar `.claude/settings.json`-e yek project neveshte mishavad
      **barāye model khanāst** (file drawer filter-e dotfile nadārad va `Read` auto-approved ast), va inke
      credential-i ke mohemm ast jāyash profile-hā-ye environment-e server ast.
- [x] Hich chiz-e digari dar `AGENTS.md` yā ADR niaz-e taghir nadārad (task-e 66).
- [x] `npm run typecheck` and `npm test` pass.
