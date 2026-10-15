# 72: The tooling comes under the typecheck and the suite

**What to build:** Do file-e tooling — `.sandcastle/main.mts` va `scripts/tickets.mjs` — biroon-e har
`tsconfig` va biroon-e `npm test` hastan. Yani do dar-e repo (`npm run typecheck`, `npm test`) in do
file rā nemibinand, va natije-ye āshkār-ash hamin bud ke ticket 71 ke raftār-e `--ticket` rā ezāfe kard
tanhā test-ash **ejrā-ye dasti** bud — va yek error-e strict-e az ghabl mojood (`main.mts:132`,
`match(…)?.[1].trim()` zīr-e `noUncheckedIndexedAccess`) ke hich chizi rā ghermez nemikonad.

Nime-ye dovom-e kār in ast ke **test-e tooling hich jāy-e zendegi nadārad**: har workspace test-e khodesh
rā dārad (`shared`/`server`/`web`), vali `scripts/` va `.sandcastle/` dar hich workspace-i nistand — pas
yek runner-e root lāzem ast, va tracker (`scripts/tickets.mjs`) bāyad `ISSUES_DIR` rā bepazirad tā
fixture-tracker momken beshavad (in file ān rā sakht-coded dārad).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `.sandcastle/main.mts` zīr-e hamān baseline-e `tsconfig.base.json` typecheck mishavad (`strict`,
      `noUncheckedIndexedAccess`, …), va error-e mojood-e `main.mts:132` fix mishavad — na bā yek cast-e
      khāmush.
- [ ] `scripts/tickets.mjs` ham typecheck mishavad. Yā `.mjs` mimānad bā `checkJs` (yek `tsconfig`-e
      jodā barāye `scripts/`), yā be TypeScript montaghel mishavad — tasmim bā dalil, na bā default.
- [ ] Yek runner-e root (vitest, hamān ke repo estefāde mikonad) ke test-hā-ye tooling rā ejrā konad va
      be `npm test` vasl shavad — bedoone inke kār-e workspace-hā dublikate yā slow-tar shavad.
- [ ] `scripts/tickets.mjs` yek fixture-tracker qabool mikonad: `ISSUES_DIR` yek parameter (yā env) ast,
      na yek constant-e sakht; az CLI ham hamchonān kār mikonad.
- [ ] Test-hā rooye **raftār** neveshte mishavand, na rooye implementation:
      `whyNotReady`/`readyTicket` dar chahār hāl (blocked / resolved / ID-e nāmojood / ready) va
      `pinnedQueue` dar se hāl (tartib-e dāde-shode / takrār / branch-e mojood).
- [ ] Entekhāb-e host-side-e `main.mts` qābel-e test ast. In emrooz na-ast: file top-level side effect
      dārad (git config, `createSandbox`), pas in logic bāyad be yek module-e qābel-e import jodā shavad
      — va `npm run sandcastle` hamchonān kār konad.
- [ ] `npm run typecheck` and `npm test` pass — va `npm test` hālā test-hā-ye tooling rā ham ejrā
      mikonad.
