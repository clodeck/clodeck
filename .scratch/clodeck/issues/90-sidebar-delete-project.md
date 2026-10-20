# 90: The sidebar deletes a project

**What to build:** Har row-e project yek menu-e `⋯` migirad ke bā hover/focus zhāher mishavad va yek item
dārad: `Delete…`. Bāz kardan-e menu **selection rā avaz nemikonad**; ru-ye phone ham yek tap-e āgāhāne
ast, na efekān-e jānā'i-ye tap ru-ye row.

`Delete…` dialog-e 88 rā bāz mikonad, bā esm-e project va **masir-e canonical** un. Bā tāyid:
`DELETE /api/projects/:id`. Natije:

- `204` → list reload mishavad, toast-e `deleted <name>` (motaghāren bā `created <name>`), va agar un
  project entekhāb-shode bud, selection be **empty state**-e "hich projecti entekhāb nashode" pāk mishavad —
  na paridan be yek project-e digar.
- refusal (`409` yā `400`) → dialog bāz mimānad va javāb-e server be-soorat-e yek jomle-ye vāzeh neshoon
  dāde mishavad (har code yek jomle: turn zende, terminal attached, symlink).
- cancel → hich chiz hazf nemishavad va dialog baste mishavad.

**Blocked by:** 88 (the typed-name dialog), 89 (the route)

**Status:** ready-for-agent

- [ ] Har row yek menu-e `⋯` dārad ke bā hover/focus zhāher mishavad va `Delete…` rā neshoon midahad; bāz
      kardan-e un selection rā taghir nemidahad.
- [ ] `Delete…` dialog-e typed-name rā bā esm va masir-e canonical-e project bāz mikonad.
- [ ] Tāyid `DELETE /api/projects/:id` mifrestad; ru-ye `204` list reload mishavad va toast-e
      `deleted <name>` zhāher mishavad.
- [ ] Hazf-e project-e entekhāb-shode selection rā pāk mikonad va empty state rā neshoon midahad; be project-e
      digar paride nemishavad.
- [ ] `409` (har do no') va `400` dialog rā bāz negah midārand va peyām-e vāzeh neshoon midahand; server
      error gom nemishavad.
- [ ] Cancel hich chiz rā hazf nemikonad.
- [ ] Test-hā: App shell (flow-e kāmel, refusal ke dialog rā bāz negah midārad, pāk-shodan-e selection) va
      row suite (menu-e row, jodā az selection).
- [ ] `npm run typecheck` and `npm test` pass.
