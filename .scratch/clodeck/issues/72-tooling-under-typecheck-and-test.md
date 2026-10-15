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

**Status:** resolved

- [x] `.sandcastle/main.mts` zīr-e hamān baseline-e `tsconfig.base.json` typecheck mishavad (`strict`,
      `noUncheckedIndexedAccess`, …), va error-e mojood-e `main.mts:132` fix mishavad — na bā yek cast-e
      khāmush. (`?.[1]?.trim()`: the optional call narrows what the index signature left possibly
      undefined, and the cast the ticket rules out is nowhere in the change.)
- [x] `scripts/tickets.mjs` ham typecheck mishavad. Yā `.mjs` mimānad bā `checkJs` (yek `tsconfig`-e
      jodā barāye `scripts/`), yā be TypeScript montaghel mishavad — tasmim bā dalil, na bā default.
      (**`.mjs` stays, with `checkJs`.** The implement prompt runs it as `node scripts/tickets.mjs`
      *inside the sandbox*, where nothing but Node is guaranteed — a migration to TypeScript would ask a
      loader of both that call and the loop's `execFileSync`. `tsconfig.tooling.json` covers `scripts/`
      and `.sandcastle/` in one config; the reason is in that file's header comment.)
- [x] Yek runner-e root (vitest, hamān ke repo estefāde mikonad) ke test-hā-ye tooling rā ejrā konad va
      be `npm test` vasl shavad — bedoone inke kār-e workspace-hā dublikate yā slow-tar shavad.
      (`vitest.config.mts` includes `.sandcastle/*.test.mts` and `scripts/*.test.mts` by name, one level
      deep, so a repo-wide glob cannot re-collect the workspaces' tests nor a worktree's copy. `npm test`
      runs it first: 11 tests, 180 ms, then the same three workspace suites with unchanged counts.)
- [x] `scripts/tickets.mjs` yek fixture-tracker qabool mikonad: `ISSUES_DIR` yek parameter (yā env) ast,
      na yek constant-e sakht; az CLI ham hamchonān kār mikonad. (Every exported function takes the
      directory as its last argument — `CLODECK_ISSUES_DIR` moves the default — and one test drives the
      CLI over a fixture directory the way the loop drives it.)
- [x] Test-hā rooye **raftār** neveshte mishavand, na rooye implementation:
      `whyNotReady`/`readyTicket` dar chahār hāl (blocked / resolved / ID-e nāmojood / ready) va
      `pinnedQueue` dar se hāl (tartib-e dāde-shode / takrār / branch-e mojood). (The four readiness
      states are asserted through `readyTicket`, the door `list` and a pin share — `whyNotReady` is the
      rule behind it, not a second surface to test. `pinnedQueue` got all three refusal cases plus the
      happy one, using the message text the README documents.)
- [x] Entekhāb-e host-side-e `main.mts` qābel-e test ast. In emrooz na-ast: file top-level side effect
      dārad (git config, `createSandbox`), pas in logic bāyad be yek module-e qābel-e import jodā shavad
      — va `npm run sandcastle` hamchonān kār konad. (`.sandcastle/queue.mts`, with the tracker and the
      branch list as two ports a test answers with. `npm run sandcastle` was run against all four
      refusals — unknown id, pinned twice, branch already there, and a typo'd flag — and word for word
      they are what they were.)
- [x] `npm run typecheck` and `npm test` pass — va `npm test` hālā test-hā-ye tooling rā ham ejrā
      mikonad.

**One thing the tracker's move turned up, and it was not the ticket's.** `scripts/tickets.mjs` is a
library and a command in one file, and its CLI ran at import: the first red run of the new suite was the
tracker's usage line and `process.exit(1)`, not a failing assertion. So the command line moved into
`main(argv)` and runs only when the file is the process's entry — which is what lets the suite import it
at all, and is why the guard folds case on Windows (`node SCRIPTS/tickets.mjs` would otherwise import
cleanly and then close nothing, a tracker command that reports success and changes no file).

**Two review findings, both about that file.** `view` named the default directory in its "no ticket"
message while reading `CLODECK_ISSUES_DIR` — a message pointing at a directory the run was not reading.
The wording now lives in one `noTicket(id, dir)` that all three callers share. And the `as` casts that
parse the tracker's JSON (`queue.mts`) came over from `main.mts` unchanged: the coding standards rule out
casts that quiet the compiler, and these are a cast at an untyped boundary rather than a silenced error —
but the honest fix is a field-by-field narrowing like `server/src/config.ts` and `ws/client-message.ts`
do, and testing that needs a runner seam this ticket does not ask for. Left as it stands, deliberately.
