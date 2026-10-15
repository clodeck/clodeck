# Clodeck — provider profiles (a session chooses the provider it runs on)

Status: ready-for-agent
Effort: clodeck

## Problem Statement

Yek developer yek project dārad va mikhāhad **hamān project** rā bā do model-e mokhtalef becharkhāne:
yek model-e arzān barāye kār-e roozmare (rename, sed, test-e sāde) va yek model-e ghavi barāye design va
architecture. Emrooz clodeck **yek** provider dārad: dar boot sakhte mishavad va be `buildApp` dāde
mishavad. Pas entekhāb yā "taghir-e kol-e server" ast yā "dast-neveshtan dar file-e project".

Va mas'ale tanhā in nist. Yek project directory **az ghabl** yek provider channel ast — bedoone hich code
— chon `.claude/settings.json` ke load mishavad (`settingSources: ['project']`) yek `env` block dārad, va
ān block ru `ANTHROPIC_*`-e process-e server **ghāleb** ast. Andāzegiri shode: file-e yek project har davāz
dah API call-e yek turn rā be endpoint-e khodesh ferestād va gateway-e ambient hich chizi nagereft.

Va in ghālebiyat **per key** ast. Yani yek project ke faghat `ANTHROPIC_AUTH_TOKEN` rā declare kone,
credential-e **khodesh** rā bā har base URL-i ke barande shod joft mikonad. Dar in hālāt, yek credential
be hosti ferestāde mishavad ke barāyash sāder nashode — va **hich warning-i** nist, chon CLI dar morede
precedence hich nemigooyad. Pas har feature-i ke per-session provider midebāyad avval in rā masoon konad.

## Solution

**Session entekhāb mikonad, na project.** Yek **provider profile** yek patch ru environment-e server ast
(`CLODECK_PROVIDER_<NAME>_*`) ke mitavānad har zirmajmooe az {endpoint, credential, model} rā declare
kone; bāghi inherit mishavad. Profile-e reserve-shode-ye **default** environment-e khode-ye server ast, pas
operator-i ke hich chiz set nakone hich taghiri nemibinad.

**Endpoint va credential bā ham safar mikonan; model āzād ast** (`docs/adr/0002-…`). Age file-e project
yeki az ān do rā declare kone, clodeck **faghat model** rā mifrestad va har do rā be project midahad; age
hich kodām rā declare nakone, har se rā az profile mifrestad. Natije: yek project ke provider-esh rā pin
karde, ān rā negah midārad — **bedoone sāmet** — va entekhāb-e session az "kodām provider" be "kodām
model" taghir mikonad, ke daghighan hamin chizi-st ke barāyash sakhtim.

Picker kenār-e **composer** mineyshad, ru **avvalin send** ghofl mishavad, va effective provider **hamishe**
neshān dāde mishavad.

## User Stories

1. As the user, I want a session to run on a provider I pick, so that I can use a cheap model for grunt
   work and a strong one for design inside the same project.
2. As the user, I want the choice to be per session, so that a new session starts clean rather than
   inheriting whatever the last one used.
3. As the user, I want the choice locked once I have sent the first prompt, so that "what am I talking to"
   never changes mid-conversation.
4. As the user, I want the picker next to the composer, so that I can change it where I type, on a phone
   as much as on a desktop.
5. As the user, I want to see which profile and model a session is **running on now**, so that I never
   have to guess.
6. As the user, I want to see that a project pins its provider, so that a choice that cannot take effect
   is explained rather than silently ignored.
7. As the user, I want to switch between a cheap and a strong profile by starting a session per profile,
   so that comparison is a sequence rather than a second pane.
8. As the user, I want a profile that changes only the model to be one line of configuration, so that
   tiers like `deepseek-flash` and `deepseek-pro` do not duplicate an endpoint and a credential.
9. As the operator, I want to declare profiles in the server's environment, so that credentials are never
   written into a convenience file.
10. As the operator, I want one reserved default profile meaning "whatever this server already has", so
    that an existing deployment is unchanged by this feature.
11. As the operator, I want a profile to inherit anything it does not declare, so that declaring a tier
    cannot accidentally blank out the endpoint.
12. As the operator, I want an unknown profile name refused visibly, so that a stale browser tab cannot
    silently fall back to a provider I did not choose.
13. As the operator, I want profiles read at boot, so that the set cannot change under a running session
    (a restart is the deliberate act).
14. As a security-conscious operator, I want a project's pinned endpoint and credential to stay together,
    so that one key in a project's `.claude/settings.json` can never send a credential to a host it was
    not issued for.
15. As a security-conscious operator, I want a project that pins only a credential to keep its model
    choice anyway, so that pinning billing does not cost me the tiers.
16. As a security-conscious operator, I want the server to never **store** or persist a credential, even
    though it now reads one, so that a compromise of the app's disk still yields nothing.
17. As a security-conscious operator, I want the client told only profile names and models — never a
    credential — so that the browser cannot leak what it never had.
18. As a security-conscious operator, I want the same rule to hold whether the pin is an endpoint, a
    credential, or both, so that I cannot misconfigure my way into a mixed pair.
19. As the user, I want a project that pins both endpoint and credential to still offer a tier choice, so
    that the cheap/strong switch survives billing isolation.
20. As the user, I want a project that pins nothing to offer every profile, so that the common case is
    the full choice.
21. As the user, I want a project that pins an endpoint to a **vendor with no tiers** to simply offer the
    models I configured for it, so that the picker never invents options.
22. As the user, I want the picker's list to come from the server rather than a hardcoded client list, so
    that adding a profile is an environment change and not a rebuild.
23. As a developer, I want the resolver to be a pure function of the environment, so that its behaviour is
    testable without a server, a key, or a network.
24. As a developer, I want the "what do we send" rule to be a pure function too, so that its
    security-critical property has an exhaustive test rather than a paragraph.
25. As a developer, I want the real provider's environment construction exported, so that the one place a
    credential is placed on the wire is not "verified by reading".
26. As a developer, I want the whole suite to keep running against the fake provider, so that no test
    needs a credential or a network.
27. As a developer, I want each profile's effect observable in the log at the moment a run starts, so that
    "which provider did that turn actually use" is answerable after the fact.
28. As a maintainer, I want the rule recorded in an ADR and the vocabulary in the glossary, so that a
    reader who meets a cookie — or a credential — behaving unusually finds the reason first.

## Implementation Decisions

### Vocabulary (from `GLOSSARY.md`)

**Provider**, **provider profile**, **tier**, **pinned project**. In hā vāzhe-hā mojoodand va hich kodām
sinonim-e digari nist: yek *tier* faghat yek *profile*-e model-only ast, na yek concept-e jodā.

### The provider module (the one new seam)

Yek module-e jadid dar server ke **faghat** shared type-hā va `node:fs`-e khoonande-rā mishnāsad (hich
SDK import nemikonad) va chāhār chiz rā expose mikonad:

- `listProfiles(env)` — az environment, list-e profile-hā: name, model, va inke **provider-shaped** ast
  yā **tier-shaped** (yani āyā `BASE_URL` yā `AUTH_TOKEN` declare karde). Yek function-e pāk az
  `NodeJS.ProcessEnv` — mesl-e `loadConfig`.
- `resolveProfile(profiles, name)` — yek **trio-e kāmel**: patch rā ru server environment mindāzad va
  key-hā-ye inherit-shode rā por mikonad. Name-e nashenās → error-e sarih, hich vaght silent default.
- `readPin(settings)` — az JSON-e parse-shode-ye `.claude/settings.json`, inke kodām key-hā declare
  shode-and. Yek predicate-e pāk; **khāndan-e file in module-e nist**.
- `envFor(profile, pin)` — **the send rule**: trio + pin → environment-e daghighi ke bāyad be
  `Options.env` dāde beshe (yā `null` age hich chizi nemifrestim). In security-critical function ast va
  eager test-e exhaustive dārad.

### Env var naming

`CLODECK_PROVIDER_<NAME>_BASE_URL`, `_AUTH_TOKEN`, `_MODEL`. Name-e profile dar server normalize mishavad
(uppercase, `-` → `_`) va list be tartib-e alfabeti bargardānde mishavad. Yek name ke ba `default` jang
kone (case-insensitive) rad mishavad, chon `default` reserve shode ast.

### The run carries a provider

- `SdkRunInput` (dar `server/src/sdk/provider.ts`) yek field-e provider migirad — shape-esh hamān trio-e
  resolve-shode ast, dar shared type-hā, na yek type-e SDK.
- `createAnthropicProvider()` digar singleton-e boot-time nist: be yek factory tabdil mishavad ke
  provider rā be har run midahad. Instance-e boot-time be **profile-e default** tabdil mishavad, pas
  deployment-i ke hich chiz set nakarde hich taghiri nemibinad.
- `toSdkOptions` hanooz hich `env`-i **nemiandāzad** ta vaghti provider-i dāde nashode; vaghti dāde shod,
  `env = { ...process.env, ...trio }` — spread **ejbāri** ast, chon `Options.env` environment rā replace
  mikonad na merge. In structure be yek function-e pāk-e **export-shode** tabdil mishavad (mesl-e
  `toSdkCanUseTool`) tā test-esh "verified by reading" nabāshad.

### The route the client reads

Yek route-e kuchak ke list rā be client midahad: **name**, **model**, va **shakl** (provider yā tier) —
va hich `BASE_URL` va hich credential. Route az `buildApp` test mishavad (hamān seam-e mojood), va be
hamrāh-e hāl-e pin-e project-e entekhāb-shode barāye hamin session.

### Reading the project's pin

Khāndan-e `<project>/.claude/settings.json` az **hamān `ScopedFs`-e mojood** migozarad (realpath +
containment), na az yek `fs`-e jadid. File-e gom-shode, JSON-e nāmoteaber, yā `env`-e gheyr-object →
"hich pin" (va yek log line), mesl-e raftār-e config-e ganjine: yek file-e bad nemibāyad server rā
bekoshad.

### The picker

- **Kenār-e composer**, na dar header. Har do hāl neshoon dāde mishavad: hāl-e zende (*"running on
  `<profile>` · `<model>`"*) va hāl-e pin-shode (*"pinned by this project"* + endpoint-e pin-shode, ke
  user khodesh ham mitavānad az drawer bekhānad).
- **List** az server miāyad. Dar yek project-e pin-shode faghat profile-hā-ye **tier-shaped** pishnahād
  mishavad — chon yek name-e model-e yek vendor ru endpoint-e vendor-e digar bimani nist.
- Ru **avvalin send** disable mishavad. Barāye taghir-e tier, yek session-e jadid; barāye resume, hāl-e
  jāri neshoon dāde mishavad, na hāl-e gozashte.
- **Hich chiz persist nemishavad.** Entekhāb dar client state mimānad. Reload → dobāre entekhāb, va chase
  ke γ neshoon midahad hamin rā gheyre-sāmet mikone.

### What we do not do

- Client hich vaght yek credential nemigirad — na dar payload-e list, na dar hich jā-ye digar.
- Server hich credential-i **neminevisad** ru disk va hich store-i ezāfe nemishavad.
- `mirror.ts` va union-e mirror dast nakhorde mimānad: `Options.env` wire format rā taghir nemidahad.

## Testing Decisions

- **What makes a good test:** faghat raftār-e **external**. Barāye in feature in yani: (1) env-i ke be
  `Options.env` dāde mishavad, (2) payload-e route, (3) chizi ke user ru safhe mibinad. Hich test-e
  private helper, hich test-e tartib-e internal.
- **Yek seam-e jadid: module-e provider.** Se function-e pāk (`listProfiles`, `resolveProfile`,
  `envFor`) + `readPin` mostaghim test mishavad, mesl-e `config.test.ts` va `allowlist.test.ts`. In hā
  hamān elguye mojood-and: function-e pāk az yek input-e sāde (env object, JSON object) → output-e
  daghigh.
- **The security-critical test, exhaustive:** barāye **har** zirmajmooe az se key dar file-e project (8
  hāl) va har profile, `envFor` bāyad yeki az in do rā bargardāne: trio-e kāmel (age pin hich kodām rā
  declare nakarde) yā **faghat model** (age har kodām rā declare karde). Hich hāli nabāyad BASE_URL az yek
  manba va credential az manba-e digar bedahad. In test-e asli-e in slice ast.
- **`buildApp` (seam-e mojood):** list-e profile-hā az route; pin-e project dar hāl-e session; name-e
  nashenās → error-e sarih; va inke list hich credential-i nadārad (yek assertion-e sāde ru payload).
  Prior art: `app.test.ts`, `projects.test.ts`.
- **Provider-e fake (seam-e mojood):** test-hā hanooz faghat bā `createFakeProvider()` kār mikonand; hich
  test-e automati credential yā network nemikhāhad. In ghāede-ye mojood ast va shekaste nemishavad.
- **Function-e env-e export-shode:** mostaghim test mishavad — hamin chizi ke ticket 07 goft nemitavānad
  dāshte bāshad (chon SDK lāzem bood tā observe konad). Hālā ke yek function-e pāk ast, spread-e
  `process.env` va se key-hā ru ān test mishavad.
- **Client:** render-e picker az yek list-e fixture, hāl-e disable-shode ba'd az send, hāl-e pinned, va
  naboodan-e picker-e provider-shaped dar yek project-e pin-shode. Prior art: suite-e component-e mojood
  dar `web`.
- **Non-goal:** hich test-e automati be yek provider-e vaghe'i vāsel nemishavad. Meghdār-e vāghe'i
  manual-e ke in slice dāsht, **hamān andāzegiri** ast ke dar ADR 0002 sabt shode va bā yek stub
  local takrār-pazir ast.

## Out of Scope

- **Do session-e zende dar yek project.** Run state ru project key shode (`turn-manager`) va re-key
  kardanesh be session bozorg-tar az kol-e in feature ast. Comparison sequential ast.
- **Persist kardan-e binding.** clodeck hanooz hich chiz ru disk neminevisad; in session-e dovvom-e
  ghofl-e client-side ast, na yek store.
- **Translation layer barāye vendor-hā-ye gheyr-Anthropic.** Gemini va amsāl az tarigh-e proxy-e operator
  miyand; clodeck yek client-e yek API shape mimānad.
- **Zakhire-ye credential dar clodeck** — na config file, na UI, na database.
- **Mahdud kardan-e dastresi be `.claude/settings.json`** dar file drawer yā barāye tool-e `Read`. File
  layer filter-e dotfile nadārad va in āgāhāne ghabool shode: credential-i ke dast-nevesht dar file-e
  project ast barāye model khanāst. Document mishavad, engineer nemishavad.
- **Validāsiun-e name-e model.** clodeck nemidānad yek endpoint kodām model-hā rā dārad; harfe ān rā
  user mizānad va error-e endpoint be user miresad.
- **Per-project profile restriction** (yani "in project faghat in tier-hā") — list global ast.
- **Multi-user** va har chizi ke az auth slice out-of-scope bood.

## Further Notes

- **ADR:** `docs/adr/0002-provider-credentials-travel-with-their-endpoint.md` — dalil-e rule, har do
  andāzegiri, va panj gozine-i ke rad shodan. **Decision ticket:**
  `.scratch/clodeck/issues/66-provider-profiles-decision.md` — jadval-e 14 tasmim.
- **Reproduction-e andāzegiri-hā**, barāye kasi ke mikhāhad takrār konad na etemād: yek stub HTTP ru
  `127.0.0.1` ke `{method, url, model, authKind, authLength}` rā log mikone va 500 midahad, be alāve-ye
  yek script ke `query()` rā bā daghighan option-hā-ye `toSdkOptions` sedā mizanad va `model`-e
  message-e `system`/`init` rā print mikone. Yek variable avaz mishavad: `settingSources`.
- **Ticket split** (barāye `/to-tickets`) — **vertical** slices, na layer slices: har ticket yek masir-e
  kāmel az environment tā safhe ast va ru khodesh demoable ast. Chāhār ticket, yek chain — va az `67`
  shomāre-gozāri shodan, na az `66a`: `scripts/tickets.mjs`'s `FILE_NAME` faghat name-hā-ye `NN-`-e adadi
  rā mikhānad, pas yek name-e gheyr-adadi **silent** az tracker miyoftād.
  - (67) **The provider seam takes its options per run** — prefactor, bedoone taghir-e raftār. *Blocker: hich.*
  - (68) **A session runs on a profile I pick, end to end** — resolver + run + route + picker kenār-e
    composer. *Blocker: 67.*
  - (69) **A project that pins its provider keeps it** — pin, ghāede-ye endpoint-credential, filter-e tier,
    hāl-e pinned, va test-e hasht-hāle. *Blocker: 68.*
  - (70) **The operator's docs catch up** — README. *Blocker: 69.*
- **In slice hich chiz-i rā dobāre tarh nemikonad:** har jā be tasmim-e 66 yā ADR 0002 este'ād midahad,
  ba shomāre eshāre kon.
