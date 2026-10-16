# 76: The transcript follows the SDK's own reset

**What to build:** Vaghti SDK conversation-e yek session rā reset mikonad, yek fram-e daghigh mifrestad —
`conversation_reset`, bā `new_conversation_id` va sabab-ash (`trigger: 'clear' | 'plan_mode_exit' |
'fresh_session' | 'onboarding'`, `sdk.d.ts:5168-5188`, member-e union-e `SDKMessage` dar `:5383`). clodeck
in rā **mindāzad**: `narrowToMirror`'s `default` arm (`server/src/sdk/mirror.ts:43-45`) `null` bar
migardānad, va test-e `mirror.test.ts:195-205` daghighan hamin rā taiid mikonad.

Natije: ba'd az `/clear` transcript-e ghabl az un ru safhe mimānad — `ChatView.entries` append-only-ast
(`web/src/chat/reducer.ts:96`) va hich message-i un rā pāk nemikonad — va ru yek reconnect snapshot-e
server (`ProjectRun.blocks`) un do transcript rā bā ham **splice** mikonad (`fromSnapshot`,
`reducer.ts:175-185`). Yani yek hālāt-e kharāb-e dā'emi, na yek bikāri-e movaqqat: hich rāhi barā-ye
bargashtan be yek transcript-e dorost nemimānad joz New chat — ke khodesh yek session-e jadid-e.

`ProjectRun.blocks` faghat dar yek jā pāk mishavad: `clearResume` (`turn-manager.ts:203-217`), ke message-e
khode clodeck (`clear_resume`) rā javāb migoyad. Un do bāyad **yek manba'** dāshte bāshand, na do emlā:
har do yek kār mikonand — transcript-e run rā pāk kardan — faghat yeki az SDK miāyad va yeki az UI.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `conversation_reset` dar `shared/src/sdk.ts` mirror mishavad — bā `new_conversation_id`, `session_id`
      va `trigger` — va dar `server/src/sdk/mirror.ts` annotate mishavad (mirror-e compile-time pin-e, pas
      `tsc` bāyad in family rā bebinad). Test-e `mirror.test.ts:195-205` ke "unmirrored mimānad" rā taiid
      mikard **bāz-neveshte** mishavad, na pāk: dalil-ash barā-ye bāghi-ye family-hā hanuz dorost ast, va
      in yek **estesnā**-st ke bāyad neveshte beshavad.
- [ ] Server: vaghti in fram miresad, `ProjectRun.blocks` pāk mishavad va yek snapshot-e tāze be
      **hame-ye** subscriber-hā broadcast mishavad — hamān kāri ke `clearResume` mikonad. Har do az yek
      implementāsiun-e moshtarak estefāde mikonand (`snapshotOf`, hamoon draft-i ke (re)connect migirad).
- [ ] Hoviat: `new_conversation_id` chera ke `sessionId`-e clodeck session-e SDK-e — un-i ke `Resume`
      behesh kār dārad — pas implement bāyad taeen konad āyā in field hoviat rā avaz mikonad yā na, va
      javāb rā dar hamin ticket benevisad. Agar avaz mikonad, header va History ham bāyad ham-rāh beshavand
      (ticket 74 hoviat rā az envelope-e server mikhānad, pas jāy-ash unhā-st).
- [ ] Client: reducer entries rā pāk mikonad — dar hamin live message **va** dar `fromSnapshot`, chon
      snapshot-e kohne-ash hanooz block-hā-ye qabl az reset rā haml mikonad (in do masir bāyad yek natije
      bedahand, varna yek reconnect transcript-e pāk-shode rā bar migardānad).
- [ ] Natije: `/clear` dasti — ke az ghabl ham kār mikone (`shared/src/protocol.ts:90` faghat yek string-e)
      — dige transcript-e ghabl rā ru safhe nemigozārad, va reconnect ham un rā bar nemigardānad.
- [ ] `npm run typecheck` and `npm test` pass.

**Out of scope (deliberate):** `New chat`-e ticket 74 — ke khodesh `clear_resume` mifrestad va az in ticket
hich chizi nemikhāhad; in ticket faghat masir-e SDK rā mibandad. Va hich command-e digari ke
`conversation_reset` tolid mikonad (`plan_mode_exit`, `onboarding`) dar UI-ye clodeck mojood nist, vali
hamin fram darbāre-ye hame-shān dorost ast.

**Bāye yādasht:** in ticket az ticket **75** biroon āmad — un menu command-hā rā neshoon midahad, va
`/clear` yeki az un-hā-st. Bug-e khodesh mostaghel-e un-e va emrooz ham vojood dārad.
