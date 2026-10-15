# 67: The provider seam takes its options per run

**What to build:** Yek prefactor, bedoone hich taghir-e raftār. `createAnthropicProvider()` digar yek
singleton-e boot-time nist: provider (endpoint, credential, model) be har run dāde mishavad, va
`SdkRunInput` ān rā haml mikone. Instance-e boot-time be **profile-e default** tabdil mishavad — yani
environment-e khode-ye server — pas operator-i ke hich chiz set nakarde daghighan raftār-e emrooz rā
migirad.

In ticket vojood dārad tā diff-e 68 dar morede **feature** bāshad, na dar morede yek signature-change.
"Make the change easy, then make the easy change."

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `createAnthropicProvider()` mitavānad provider rā **per run** begirad; instance-e boot-time be
      **default profile** tabdil mishavad (environment-e khode-ye server), va yek operator ke hich chiz
      set nakarde hich taghiri nemibinad.
- [ ] `SdkRunInput` provider rā dar **shared type-hā** haml mikone (trio) — hich type-e SDK be `shared`
      vāred nemishavad, va ghāede-ye mojood ("`shared` hich dependency-e `@anthropic-ai` nadārad") shekaste
      nemishavad.
- [ ] Environment-i ke be SDK dāde mishavad az yek **function-e pāk-e export-shode** miyāyad: bā yek
      provider-e resolve-shode `{ ...process.env, ...trio }` bar-migardānad, va bedoone provider **hich**
      `env`-i set nemikonad (raftār-e emrooz).
- [ ] Spread-e `process.env` **dākhel-e** hamān function ast, chon `Options.env` environment-e subprocess
      rā **replace** mikonad na merge. (In bayad dar comment-e function sabt shavad.)
- [ ] Function mostaghim test mishavad: environment-e ambient bāghi mimānad, se key override mishavad, va
      hāl-e bedoone-provider hich `env`-i set nemikonad.
- [ ] **Hich taghir-e raftāri:** kol-e suite sabz mimānad, taghirāt-e mojood faghat signature-e mekāniki
      hastan, va hich test credential yā network nemikhāhad.
- [ ] `npm run typecheck` and `npm test` pass.
