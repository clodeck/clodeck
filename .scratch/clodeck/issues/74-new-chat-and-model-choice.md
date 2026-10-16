# 74: New chat starts a session on the model I pick

**What to build:** Yek dokme-ye `New chat` dar header-e chat ke yek session-e jadid rā **vāghe'an** shoroo
konad: chat state rā pāk mikonad va hamān-ham resume target-e armed va buffer-e transcript-e server rā — ru-ye
har do taraf-e wire — tā send-e ba'di yek session-e jadid bāshad, na edāme-ye un-i ke az ghabl armed bood.

In raftār dar docs tarif shode vali hich vaght sākhte nashode: `06-session-project-data-model.md:29,65` va
`spec-02-chat-transport.md:67` migoyand *"New session = clear chat state + clear the resume target; nothing is
written to disk until the first send"* — va hich kontroli barā-ash vojood nadārad. Dar hamān hal in ticket yek
gap-e shenākhte-shode-ye ticket 11 rā ham mibandad: *"No way to cancel an armed resume. The protocol carries
no 'clear the target' message"* (`11-web-history-resume.md:60`).

Hamzamān, picker-e kenār-e composer bāyad un chizi rā ke kārabar entekhāb mikonad avval begoyad — **model** —
na faghat name-e profile; va hālat-e ghofl-shode-ash bāyad dar-e jadid rā neshoon bedahad. Va header-e chat
bāyad begoyad to dar kodām session hasti, az envelope-e server (ke `sessionId` rā az ghabl haml mikonad va
client hich vaght nemikhanad-esh, `shared/src/protocol.ts:26`), tā yek restart-e server hoviat rā gom nakonad.

Hich chiz persist nemishavad — na file, na store, na localStorage-e jadid (decision 66,
`66-provider-profiles-decision.md:62`). New chat tā avvalin send hich chiz ru disk neminevisad.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Yek dokmeye `New chat` dar header-e chat, chap-e `History` (sentence case, mesl-e baghi-ye dokme-hā-ye
      header).
- [ ] `New chat` client state rā pāk mikonad (transcript-e live, `sessionId`, resume target, banner-e resume)
      **va** hālat-e server rā bā yek message-e jadid dar protocol (`clear_resume`): target-e armed-e un project
      **va** buffer-e block-hā-ye run. Bedoone pāk kardan-e target, send-e ba'di sokoot-vār session-e ghabli rā
      edāme midād va dokme dorugh migoft; bedoone pāk kardan-e buffer, yek reconnect (snapshot) transcript-e
      session-e ghabli rā bar migardānd. In ham gap-e #1-e ticket 11 rā mibandad.
- [ ] `New chat` **lazy**-e: tā avvalin send hich session-i sākhte nemishavad va hich chiz ru disk neveshte
      nemishavad; chat-i ke hich prompt-i nafrestāde dar History hich entry-i nadārad. In mahdudiat-e platform-e,
      na entekhāb: server bedoone prompt nemitavānad session besāzad — `session_id` ru-ye init-e `system`
      miyāyad.
- [ ] `New chat` vaghti yek turn dar hāl-e ejrā-st disabled-e, bā tooltip-e
      `a turn is running — interrupt it, or wait for it to finish`. Vaghti yek resume target armed-e disabled
      **nist** — in dokme hamān rāh-e otogh-e un-e.
- [ ] Picker **model-first** mishavad, bā hamān ghom-e *"running on X now"*-e decision 10:
      `running on deepseek-reasoner · PRO`. Vaghti un profile hich model-i declare nakarde:
      `server environment · the endpoint decides`. Label-e profile-ye reserve-shode hamchonān
      `server environment` mimānad, va project-e pinned hamchonān faghat tier-hā rā arze mikonad bā
      `pinned by this project · <endpoint>`.
- [ ] Dalil-e ghofl-e picker dar-e jadid rā neshoon midahad: `a turn has already run in this session, so the
      profile is set — start a new chat to run on something else`.
- [ ] Yek chat-e jadid ru profile-i bāz mishavad ke ākharin bār dar hamān project estefāde shod (ghā'ede-ye
      ticket 68) — va name-e stale hamchonān **visible** rad mishavad, hich vaght silent be default fallback
      nemikonad (decision 13; `providerMemory.test.ts:69`). Yek send-e rad-shode picker rā ghofl nemikonad.
- [ ] Resume taghir nemikonad: resume hamān session rā tawse'e midahad (magar bā fork), va model māl-e **run**
      ast — resume hich vaght model-e ghabli rā az no zende nemikonad. Dar chat-i ke hanuz hich turn-i
      nandākhte, picker barā-ye un edāme āzād mimānad.
- [ ] Header hoviat-e session rā migoyad: `Chat` mimānad, ba'd title-e session (hamān string-i ke History
      neshoon midahad — yek manba', na do emlā), truncate-shode, bā tooltip-e title-e kāmel + id. Ghabl az
      avvalin send: `new chat`.
- [ ] Client `sessionId` rā az envelope-e event mikhanad (`shared/src/protocol.ts:26`, por-shode dar
      `server/src/ws/turn-manager.ts:314`), pas hoviat-e session-e feli bā restart-e server gom nemishavad va
      `Resume`-e natije dige be `{mode:'continue'}` tanāzol nemikonad.
- [ ] **Hich chiz persist nemishavad**: na file-e jadid, na store, na key-e jadid dar localStorage. Decision 66
      dast-nakhorde mimānad.
- [ ] Docs: do line-i ke "New session = client state clear" migoyand (`spec-02-chat-transport.md:67`,
      `06-session-project-data-model.md:29,65`) bā message-e jadid ham-rāh mishavand, va bakhsh-e
      provider-profiles dar README yek jomle migirad ke `New chat` dar-e un-e. Hamin qadr — na yek ticket-e
      docs catch-up.
- [ ] `npm run typecheck` and `npm test` pass.

**Out of scope (deliberate):** zende mondan-e session-e feli ba reload — gap-e #2-e ticket 11, ke yek
snapshot/protocol change-e khod-esh-e; list-e session-hā dar sidebar, ke dar decision D2 rad shode
(`prototype-parity.md:79-86` — session-hā posht-e `History` mimoonan); va name-gozāri/rename-e session-hā, ke
hich ticket-i barā-ash vojood nadārad.
