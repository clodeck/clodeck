# Prototype parity — gap list + priority

**In file ticket nist.** Input-e `/to-tickets` ast: az har `P1`/`P2` item yek ticket dar miyad, va
`P0`-ha ghabl az ticket kardan **tasmim** mikhahan (har kodum yek soal-e yes/no az user).

**Source:** decision 03 (`.scratch/web-claude-ui/issues/03-visual-prototype.md`) + prototype-e
verify-shode (Variant A, `.scratch/web-claude-ui/prototype/`) moghayese ba UI-e feli-e `web/src/`.
Tasmim-e asli: **Variant A — "chat-first, tools on demand"** (rail ▸ sidebar ▸ chat stage; terminal va
files dar bottom drawer).

**Chizi ke in list nist:** hich item-e MVP-e `AGENTS.md` gom nashode — chat stream, history/resume,
project switcher, file drawer (tree + create/rename/delete/upload + editable toggle/save), terminal,
auth, deploy hame hastan. Pas in list **na bug-haye MVP** ast, na scope creep: tafavot-e
prototype↔mahsul ast ke bayad ya taeid shan ya biyan.

**Vaziyat:** `main` clean, build kamel (`23d770f`). Hich item-e inja hanooz shoru nashode.

---

## Tasmim-haye gerefte-shode (2026-10-12)

Chahar soal-e `P0` javab gereftan; inja sabt shodeand ta session-e ba'di dobare naporsad.

- **D1 = (a) — bargasht be Variant A.** Rail ▸ project sidebar ▸ chat stage, va terminal **va** files
  dar yek **bottom drawer**-e summonable (42vh). In hamun chizi ast ke decision 03 (`map.md`) gofte bud —
  pas split-e do-sotune drift-e mahsul bud, na tasmim. Ticket **35** (shell + rail + tabs) va **36**
  (`300px tree | code view`).
- **D2 = hamin ke hast.** Sessions dar **History button**-e header-e chat mimoonan; sidebar faghat
  projects. **Bedoone ticket** — do manba-e-haghighat sakhtan gereh-e bi-arzesh ast.
- **D3 = har 5 item be MVP miad:** #15 download, #16 markdown preview, #17 metadata, #18 tree⇄flat, #19
  drag-move. Ticket **32** `AGENTS.md` + `spec-04` ro be-rooz mikone (ghabl az kod), va **40/41/42/43/44**
  feature-ha-ro.
- **D4 = toast-e kootah-e movafaghiat.** Ticket **37** (va **33** baraye token-e `--color-ok`, ke badge
  ham lazamesh darad).
- **P2:** faghat **#24** (line-number + highlight) entekhab shod → ticket **45**. Baghi-ye `P2` (#7, #8,
  #9, #10, #26) bi-ticket mimoonan, va `P3` hamin-tor rad-shode ast.

Do ja prototype be mahsul **muntaghel nemishe** va ticket-ha tasmim-e khodeshun ro neveshtan: download
client-side `Blob` nist (content truncate mishe, binary hich vaght nemiad → 42 route-e server mikhad), va
flat-list recursiv nist (listing lazy ast → 41 faghat hamun directory).

---

## P0 — tasmim-e ghabl az ticket

In chahar ta **structure va scope** ro avaz mikonan, pas ticket-haye ba'di-ro gheyde-mand mikonan.
Hamegi be tavsie-e man + yek soal-e yes/no.

### D1 — Drawer bargarde ya nah? (#3, #7, #23)

- **Prototype:** terminal + files ye **bottom drawer**-e summonable (42vh) ba tab-haye
  `Terminal` / `Files · read-only`, az rail baz mishod
  (`prototype/variant-a.js:18,23-31,75-84`). Files dakhelesh **side-by-side**: `300px tree | code view`
  (`variant-a.js:140-146`).
- **Feli:** har do **column-e sabet-e rast**, terminal roye files, hamishe roye screen
  (`web/src/App.tsx:108-124`); tree roye, preview paeen (stacked).
- **Gozine-ha:** (a) be Variant A bargardan — drawer + tabs; (b) besaz hamun do-sotune, vali
  side-by-side kon (tree | preview); (c) hamin ke hast, taeid kon.
- **Tavsie:** **(c)** — baraye yek karbar-e tak, dastresi-e hamishegi be terminal/chat arzesh dare va
  drawer baraye bargashtan be mental-model-e claudecodeui nist. Vali in tasmim-e karbar ast, na man.
- **Agar (a)/(b):** ticket jadid + eshare be `variant-a.js` baraye reference.

### D2 — Session list koja bashe? (#4)

- **Prototype:** sessions dar sidebar, zir-e projects, ba chip-e `Sessions · N` va har row
  `title` + `updated · live` (`variant-a.js:42-54`, `common.js:753-763`).
- **Feli:** sidebar faghat projects; sessions rafte poesht-e dokme-ye **History** dar header-e chat
  (`web/src/chat/ChatPanel.tsx:44-53,65-85`), az REST (`useSessions`) ba mark-e `current`.
- **Tavsie:** **(b) taeid-e hamin** — chon session-ha az REST miyan va resume/transcript hamunja
  zendegi mikonad, negah dashtaneshan dar sidebar do manba-e-haghighat misazad. Bedoone ticket.

### D3 — Kodum az "out of MVP"-e decision 03 be MVP biad?

In 5 ta dar prototype **hast** va dar `spec-04:216-223` **aghab-e MVP** gozashte shodeand. Har kodum
yek tasmim-e joda ast — hamegi ba ham ya hich kodum:

| # | Item | Prototype | Feli | Yad-dasht |
|---|---|---|---|---|
| 15 | **Download** (Blob) dar header-e viewer | `variant-a.js:88-97,132` | nist (hich `download` dar `web/src` nist) | server taraf-e karband nist; client-side Blob az hamun content |
| 16 | **Markdown preview** (Preview⇄Source) | `common.js:122-173,698-700` | nist (text-e kham) | `spec-04:219` — "live editing" hamchenan out |
| 17 | **Metadata**: size · modified · permissions | `common.js:86-95` + list column-ha | nist | data **hast**: `FileEntry` size+mtime dar `shared/src/files.ts:17-20`; dir-ha hich kodum nadaran |
| 18 | **Tree ⇄ flat-list** toggle | `common.js:457-476,559-564` | nist | kamtarin arzesh baraye yek karbar |
| 19 | **Drag-move** file roye folder (+confirm) | `common.js:625-643` | nist (bedoone `draggable`) | cross-dir move REST nadarim — `rename` hamun-directory ast (`spec-04:218`) |

- **Tavsie:** az in 5 ta **#15 (download)** va **#17 (size/mtime har row)** bishtarin arzesh-e har
  rooz ro daran va arzun-and; **#19** geran-tar ast (route-e jadid) va kam-takrar; **#16** va **#18**
  ra bezar out.
- **Har item-e entekhab-shode yek ticket-e joda**, va bayad `AGENTS.md`'s MVP bullet + `spec-04`
  out-of-scope list ham be-rooz shan (varna do document tazad migiran — hamin etefagh baraye
  editable toggle oftad, `spec-04:251`).

### D4 — Feedback-e movafaghiat (toast) ya khamushi?

- **Prototype:** har op-e movafagh toast midad (`renamed to X`, `3 uploaded`, `synced`)
  (`common.js:666-672`).
- **Feli:** faghat **error** notice bashe (`FilePanel.tsx:113-125`); create/rename/delete/upload-e
  movafagh khamush re-list mishan.
- **Tavsie:** **toast-e kootah-e movafaghiat** — arzun, va "click kardam, hich chizi nashod" ro az
  beyn mibare. (Baraye download ham hamin toast lazem ast, pas ba D3#15 ham-raste.)

---

## P1 — in-MVP, kam-hazine, value-e ziyad

In ha **hich scope-e jadid** nemikhan; ya polish-e UI-e mojood-an ya server taraf-e karband nist.
Har item yek ticket-e koochak.

| # | Item | Feli | Eslahe pishnahadi |
|---|---|---|---|
| 20 | **Upload drop overlay + cap** | Drop kar mikone vali hich overlay/highlight/hint nist; cap-e 200 MiB faghat server-side 413 (`server/src/files/transport.ts:23,110`) | Overlay-e `Drop files to upload · max 200 MB` + highlight-e target + pre-check-e size dar client, hamun andaze ke prototype dasht (`common.js:373-381`) |
| 21 | **Upload-e chand-file** | Upload-ha seri va har kodum yek request-e joda, hata vaghti >1 file (`FilePanel.tsx:39-45`) | Bashe; vali ba toast-e D4 yek kholase-e `N uploaded` bede |
| 11 | **Composer: autogrow + foot hint** | Textarea `rows={2}`-e sabet, bedoone autogrow; dokme-ye `Send`-e texti; hich hint | Autogrow ta ~160px + line-e hint-e `Enter to send · Shift+Enter for a newline` (`common.js:224-241`) |
| 12 | **Tool card: badge-e status** | Do `<details>`-e baste (Input/Result) bedoone status-e `running…`/`done`; karbar bayad baz kone ta hich chizi bebine (`chat/EntryView.tsx:41-80`) | Badge-e status (rang-e `ok` baraye done) + baz kardan-e khodkar-e body vaghti done shod |
| 14 | **Rang-e `ok`** | Palette faghat canvas/panel/line/ink/ink-dim/accent/err darad (`index.css:5-14`) | Token-e `--color-ok` az prototype (`styles.css:17-18`), mesl-e `err` |

---

## P2 — parity-e visual / interaction (arzesh-e kamtar)

Bedoone tasmim-e jadid, vali nabayad ba P1 ghati shan. Har item mitone yek ticket-e kuchak bashe.

| # | Item | Prototype | Feli | Note |
|---|---|---|---|---|
| 7 | Transcript-e centered | `max-width:780px` (`styles.css:108`) | full-width | Samt-e chat-e boland-khanan behtar mishe |
| 8 | Avatar-e assistant | 26px tile-e gradient har turn (`common.js:208-209`) | nist | |
| 9 | Toolbar ba icon | icon-btn-ha (`common.js:550-566`) | dokme-haye texti (`New File`, `Upload`, …) | text vazeh-tar ast; icon-e prototype "joz-e design" bood |
| 10 | Level-e background | 5 level (`--bg`…`--bg-4`) | 2 level (`canvas` + `panel`) | flat-tar; shayad bedoone eslahe |
| 24 | Code view: line-number + highlight | gutter + `highlight()` (`common.js:99-119`) | `<pre>`-e kham | Baraye "download/preview"-e file-ha behtar mishavad, vali kar-e jadid ast |
| 26 | Chip-e `read-only`⇄`editable` | lock/pencil icon (`variant-a.js:98-103,136`) | micro-label + dokme-ye `Edit` | hamin behtare, vali matn-e label bedoone vahdat ast |

---

## P3 — rad-shode / bi-olaviyat (bedoone tasmim-e jadid dast nazan)

- **#1, #2 — Nav rail** (icon-haye chat/terminal/files/search/settings). Dar mahsul-e do-sotune
  hich kar-e vagei nemikone; search/settings/add-project/session-⋯/branch-chip hame mock-e
  prototype boodan va dar `AGENTS.md` "Out of MVP" hastan (git explorer, model picker, plugins).
  **Superseded 2026-10-13:** `add-project` digar mock nist — project az sidebar sakhte mishe
  (`issues/46-project-creation-decision.md`, ticket 47); search/settings/session-⋯/branch-chip hanuz
  mock-and va out of MVP mimanan.
- **#6 — chip-e git branch / `3 changed`** — git explorer out of MVP ast.
- **#13, #5 (auth/footer)** — `LoginScreen` + Log out ja-ye footer-e mock-e prototype ra gerefte
  (`spec-05:130`); hich kari lazem nist.
- Item-hayi ke UI-e feli **behtar** az prototype darad va bayad negah dashte shan: approval modal,
  interrupt, error banner ba code-ha, line-e cost/stop-reason, resume (continue/latest/fork),
  jam-e `thinking`, nesting-e subagent, row-e symlink-e non-navigable, note-e `truncated`/`binary`.

---

## Appendix — evidence map (baraye ticket-nevisi bedoone re-derive)

| Item | Prototype (reference) | Feli |
|---|---|---|
| Layout-e A | `variant-a.js:18` (grid 52/244/1fr), `:21-31` (rail), `:42-54` (sidebar sessions), `:63-69` (header) | `web/src/App.tsx:48-77,99-126` |
| Drawer | `variant-a.js:75-84,153-179` | nist |
| Project rows | `common.js:738-751` | `web/src/ProjectSwitcher.tsx:46-67` |
| Session list | `common.js:753-763` | `web/src/chat/SessionHistory.tsx:18-112` |
| Chat transcript | `common.js:202-284`, `styles.css:107-151` | `web/src/chat/ChatPanel.tsx:135-184`, `chat/EntryView.tsx` |
| Tool card | `common.js:176-200` | `chat/EntryView.tsx:41-80` |
| Composer | `common.js:216-284`, `styles.css:153-173` | `chat/ChatPanel.tsx:320-364` |
| File tree + ops | `common.js:359-676` | `web/src/files/FilePanel.tsx` |
| useFiles actions | — | `web/src/files/useFiles.ts:63-89` |
| Preview/editor | `common.js:678-735` | `files/FilePanel.tsx:450-576` |
| Upload cap (server) | — | `server/src/files/transport.ts:23,110` |
| Palette | `styles.css:4-24` | `web/src/index.css:5-14` |
| Terminal | `common.js:286-357` (fake) | `web/src/terminal/useTerminal.ts:40-123` (real) |

---

## Tarz-e estefade dar session-e jadid

1. `P0` — ~~chahar soal-e D1..D4 ro az user bepors~~ **javab dade shod** (2026-10-12) va dar bakhsh-e
   "Tasmim-haye gerefte-shode" sabt ast. Javab-ha `AGENTS.md` + `spec-04` ro avaz mikonan — oon kar
   ticket **32** ast.
2. `P1` (+`P2`-e entekhab-shode + `D3`-e entekhab-shode) → `/to-tickets`: **anjam shod** — ticket-ha
   **32…45** dar `.scratch/clodeck/issues/`. Har kodum ba eshare be `Appendix` (bedoone re-derive) va
   block-haye vazeh.
3. `P3` ra nanevis — in ha tasmim-e ghabl-and, na kar-e moam-and.
