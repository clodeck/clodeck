# 69: A project that pins its provider keeps it

**What to build:** Yek project directory **az ghabl** yek provider channel ast: `.claude/settings.json`-e
un `env` block dārad va ān block ru `ANTHROPIC_*`-e process-e server **ghāleb** ast. In ticket ān vāgheiyat
rā az yek khatar be yek gharārdād tabdil mikone: **endpoint va credential bā ham safar mikonan, va model
āzād ast**.

Age file-e project endpoint **yā** credential rā declare kone, clodeck **faghat model** mifrestad va har do
rā be project midahad. Age hich kodām rā declare nakone, har se rā az profile mifrestad. Va hich hāli
nabāyad BASE_URL az yek manba va credential az manba-e dige bedahad — chon precedence **per key** ast, yek
key-e tanhā dar file-e project kāfi ast tā yek credential be hosti ferestāde beshe ke barāyash sāder
nashode, bedoone hich warning.

**Blocked by:** 68 (needs a run that carries a provider, and a picker to show the pin in)

**Status:** ready-for-agent

- [ ] `<project>/.claude/settings.json` az **hamān `ScopedFs`-e mojood** khānde mishavad (realpath +
      containment), na az yek `fs`-e jadid.
- [ ] Inke ān file kodām key-hā rā declare karde az yek **function-e pāk** miyāyad. File-e gom-shode,
      JSON-e nāmoteaber, yā `env`-e gheyr-object = "hich pin" (bā yek log line) — yek file-e bad nabāyad
      server yā session rā bekoshad.
- [ ] Yek project ke endpoint yā credential declare karde dar picker **pinned** neshoon dāde mishavad, va
      ānjā faghat profile-hā-ye **tier-shaped** pishnahād mishavad — chon yek name-e model-e yek vendor ru
      endpoint-e vendor-e digar bimani nist.
- [ ] Vaghti project endpoint yā credential rā declare karde, run **faghat model** mifrestad; endpoint va
      credential har do māl-e project mimoonan.
- [ ] Vaghti project hich kodām rā declare nakarde, run **har se** rā az profile mifrestad.
- [ ] **Exhaustive acceptance test:** ru har **hasht** zirmajmooe-ye se key, hich tarkibi nabāyad endpoint az
      yek manba va credential az manba-e dige bedahad. In test-e asli-e in ticket ast.
- [ ] Ghāede **server-side** e'māl mishavad: yek client-e dastkāri-shode ke dar yek project-e pinned yek
      profile-e provider-shaped bekhaahad nemitavānad yek joft-e makhloot begirad.
- [ ] Log line migo **chi ferestāde shod va chi negah dāshte shod** va chera.
- [ ] Yek project ke hich `.claude/settings.json` nadārad daghighan mesl-e ticket 68 raftār mikonad.
- [ ] `npm run typecheck` and `npm test` pass.
