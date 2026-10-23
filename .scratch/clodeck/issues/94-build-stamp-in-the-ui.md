# 94: The UI shows which commit is running

**What to build:** Ba'd az har deploy, to — hatta ro-ye **login screen**, ghabl az vāred shodan — mibini ke
kodoom commit dar hāl-e ejrā-st, key build shode, va āyā tree-e build kāri nāpāk bud. Hamoon khatt dar
sidebar header (desktop va sidebar-e `md`-e phone) va dar login screen zhāher mishavad.

Stamp do chiz rā **az ham jodā** negah midārad: `commit` va `builtAt`. In lazeme, chon force-deploy-e yek
commit-e sabt-shode commit rā avaz nemikonad va bedoone `builtAt` az "hich chiz nashode" jodā nemishavad.
Stamp **artifact-e build-shode-i ke run mishavad** rā tosif mikonad, na checkout-e git
(`docs/adr/0004-build-stamp-is-baked-at-build-time.md`).

Zanjire-ye kāmel: `npm run build` stamp rā minevisad dakhele artifact-e server → server vaqt-e boot ān rā
**yek bār** mikhānad → `GET /healthz` ān rā barmigardānad → client yek bār mikhānad va neshoon midahad.
Bedoone git (Docker) `commit` = `unknown`; dar dev loop = `dev`. Hich kodomi makhfi nemishavad.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `npm run build` stamp rā dakhele artifact-e build-shode minevisad: commit-e kāmel (40-hex), zamān-e
      build (ISO), va `dirty` az `git status --porcelain`. Bedoone repository, `CLODECK_BUILD_COMMIT` rā
      tarjih midahad va vagarna `unknown` minevisad — build nemishekand.
- [x] Server stamp rā vaqt-e boot yek bār az kenār-e kod-e khodesh mikhānad; agar file nabāshad (dev loop)
      `dev` ba `builtAt: null` ast. `app.ts` hich vāght git yā file nemikhānad: stamp az tarigh-e
      `AppOptions` miresad, mesl-e `webRoot`.
- [x] `GET /healthz` → `{status:'ok', build:{commit, builtAt, dirty}}`, ba `status` **aval** (do script-e
      setup/deploy bā `grep -q '"status":"ok"'` match mikonan) va `cache-control: no-store`.
- [x] Dar dev loop, proxy-e Vite `/healthz` rā ham be backend mifrestad, pas stamp ro-ye login screen ham
      zhāher mishavad.
- [x] Sidebar header (zir-e "remote Claude Code") va login screen stamp rā neshoon midahand:
      `fcbd770 · 2026-10-23 14:05`, bā suffix-e `-dirty` vaghti nāpāk ast, `unknown` va `dev` bedoone
      māsk. `title` SHA-ye kāmel-e 40-harf-i rā dārad. `builtAt` ro-ye client be vaqt-e mahalli-e browser
      format mishavad.
- [x] Dockerfile `CLODECK_BUILD_COMMIT` rā be onvāne `ARG` mipazirad va be `ENV` tabdil mikonad.
- [x] Docs-i ke body-e `/healthz` rā literally neveshteand (`docs/deployment.md`, `docs/fa/guide.finglish.md`,
      `docs/ci-cd.md`) update mishavand; do script-e `grep` dast nakhorde mimānanad vali yek comment
      migirand ke `status` bāyad aval bemoonad.
- [x] Test-hā: `app.test.ts` (shape-e `/healthz`, `no-store`, va stamp-e injected), suite-e hook-e client
      (fetch va fallback-hā), `App`/`LoginScreen` (namāyesh-e se hālat: `commit`, `-dirty`, `dev`/`unknown`),
      va test-e script-e build-stamp (git-e mojood, bedoone git, `CLODECK_BUILD_COMMIT`).
- [x] `npm run typecheck` and `npm test` pass.
