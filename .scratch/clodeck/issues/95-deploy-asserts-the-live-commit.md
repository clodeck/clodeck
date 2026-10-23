# 95: The deploy refuses to call a build live when it isn't

**What to build:** Deploy, pas az restart, dige faghat "yek javāb-e 2xx" rā healthy nemishmārad: commit-i
ke `/healthz` gozāresh midahad rā bā SHA-yi ke khodesh deploy kard moghāyese mikonad. Nabarābari —
shāmel-e `unknown` — yek deploy failure-e, na yek health success, va hamoon rollback-e hamishte ejrā
mishavad.

In chizhāyi rā migirad ke hich chiz-e dige nemigirad: build script ejrā nashode, checkout-e ghalat, va
**process-i ke restart nashode** — chon stamp vaqt-e boot khānde mishavad, process-e ghadimi stamp-e
artifact-e ghadimi rā barmigardānad. `unknown` dar in masir hamishte failure ast, chon deploy az yek
checkout-e git build mikonad.

**Blocked by:** 94 (the stamp and the `/healthz` payload)

**Status:** ready-for-agent

- [ ] Deploy, pas az restart, `/healthz` rā mikhānad va `build.commit` rā bā SHA-ye verified-e deploy
      moghāyese mikonad (`jq` ro-ye server nist: parse bā `node -e`/`node -p`).
- [ ] Nabarābari yā `unknown` → deploy failure-e, ba exit-e non-zero va hamoon rollback-e hamishte.
- [ ] Parse-e yek body-e ghalat yā nā-motarāfez (server-e kohne ke `build` nadārad) ham failure-e, na
      crash-e script.
- [ ] In check be `restart_and_wait` ezāfe mishavad ke ham forward va ham rollback az ān ostefāde mikonand —
      ro-ye rollback niz mohim ast: rollback-e ghalat-mokhtoum yādi migirad.
- [ ] Har do copy update mishavand: `scripts/clodeck-deploy.sh` (reference) va copy-e root-owned-e ro-ye
      server (`/usr/local/bin/clodeck-deploy`). Ghesmat-e dovvom yek qadam-e ensāni-st — runbook-e nasb.
- [ ] `docs/ci-cd.md` update mishavad (ghadam-e 5 dige "che javābi healthy e" nist).
- [ ] Verification: yek deploy-e vāghe'i ro-ye server, ba SHA-ye tamāshā-shode dar UI — evidence dar
      ticket. (In repo Docker/deploy rā bā unit test tasdiq nemikonad.)
- [ ] `npm run typecheck` and `npm test` pass.
