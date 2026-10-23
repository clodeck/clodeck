# Clodeck — rahnamaye Finglish

> **In README-e rasmi nist.** Yek rahnamaye Finglish baraye ejra kardan-e Clodeck ast: Windows,
> server-e Linux, vared kardane API key, va un chiz-hayi ke bayad bedooni.
> Manba-e rasmi hamishe [`README.md`](../../README.md) ast — har ja in do tafavot dashtan, un dorost ast.

---

## 0) Clodeck dar 30 saniye

Clodeck yek web UI rooye **Claude Agent SDK** ast: az har browser, rooye har machine, be Claude Code
vasl mishi — chand ta project directory ke rooye yek server-e khodi oftadan.

Se chiz ke kolle fekr ra miresanad:

1. **Har project = yek folder.** Hich database-yi vojood nadarad. Immediate child directory-haye
   `PROJECTS_ROOT` *khode registry* hastan. Yek level paeentar-tar dide nemishavad.
2. **Yek user, yek password.** `UI_PASSWORD`. Hame route-ha va har do websocket posht-e un hastan.
3. **Server va client yek origin hastan.** Dar dev do process (`:5173` Vite + `:3001` server) va dar
   production yek process (`:3001` khodesh client-e build-shode ra serve mikonad). Be hamin dalil
   CORS nadarim va cookie-e session rooye hame chi mineishinad.

Har project se chiz darad: yek chat session (Agent SDK), yek shell (terminal), va yek file drawer
(scoped be project root — read **va** write). Terminal va Files **yek** drawer-e paeeni hastan ke az
rail baz mishavad, na yek column-e daemi.

---

## 1) TL;DR — gozaresh-e fori

**Windows (mahale khodam):**

```powershell
cd $HOME\clodeck
.\start-clodeck.ps1          # .env ra load mikonad, build mikonad, serve mikonad
# bad: http://127.0.0.1:3001  →  password-e .env ra bezan

# ya baraye dev loop (hot reload) — ham .env load mishavad:
npm run dev:env              # bad: http://localhost:5173
```

**Windows, az sefr (wizard):**

```bash
# dakhel-e Git Bash (na PowerShell!)
cd /d/projects/clodeck/clodeck
bash scripts/setup-clodeck.sh
# bad dar yek PowerShell-e jadid:
.\start-clodeck.ps1
```

**Linux server (systemd):**

```bash
npm run serve                # ba PROJECTS_ROOT / UI_PASSWORD_FILE / ANTHROPIC_API_KEY dar env
# bad: ssh -N -L 3001:127.0.0.1:3001 clodeck@server  →  http://localhost:3001
```

---

## 2) Pish-niaz-ha

| Chi | Chera | Check |
|---|---|---|
| **Node ≥ 22.12** | npm workspaces + server | `node --version` |
| **Yek folder baraye project-ha** | ina *khode* project-hastan | — |
| **API key** — faghat baraye yek feature | javab-e **chat** az Agent SDK miyayad. Login/terminal/files/history bedoone key ham kar mikonand | — |

Mesle har platform:

| Platform | Ezafi |
|---|---|
| **Windows** | Hich. `node-pty` binary-e amade darad; terminal PowerShell ra zir-e ConPTY mizanad |
| **Linux** | `python3`, `make`, `g++` — chon `npm install` bayad `node-pty` ra compile konad: `sudo apt-get install -y python3 make g++` |
| **macOS** | Hich |

---

## 3) Windows — az sefr ta login

### 3.1 Nasb

```powershell
git clone https://github.com/clodeck/clodeck.git $HOME\clodeck
cd $HOME\clodeck
npm install                        # har se workspace: shared, server, web
```

`npm install` hamchenin `core.hooksPath` ra rooye `.githooks` set mikonad — yani pre-commit hook
fael mishavad (typecheck + test + check-e ticket-ha).

### 3.2 Projects root

```powershell
mkdir $HOME\clodeck-projects\hello
```

Hamin. Dar `.env`-e khodam `PROJECTS_ROOT=C:\Users\<you>\clodeck-projects` daram.

### 3.3 Do rah-e ejra: `dev` ya `serve`

| | `npm run dev` | `npm run serve` |
|---|---|---|
| Baraye | development, hot reload | **hamin chizi ke deploy mishavad** |
| Process-ha | 2 ta (Vite `:5173` + server `:3001`) | 1 ta (`:3001`, client ra khodesh serve mikonad) |
| Chi baz konam | `http://localhost:5173` | `http://127.0.0.1:3001` |
| In ra dar | vaghti rooye UI kar mikonam | **har vaght mikham az chiz-e vaghe-i estefade konam** |

`npm run dev` bedoone dotenv ast, yani `.env` ra **nemikhanad**. Pas faghat hamun do variable-i ke dasti
set mikoni be server miresan, va baghie — az jomle credential — **saket** gom mishan. Do rah dari:

**Rah-e 1 — `.env` ra load kon** (in ra baraye har rooz estefade kon):

```powershell
npm run dev:env                 # .env → environment → npm run dev
npm run dev:env -- dev:fake     # ya har script-e dige
```

`dev:env` esm-e key-haye load-shode ra chap mikonad — hich vaqt value-ha ra, chon secret hastan — va bad
loop ra mizanad. Age `.env` nabashad, ejra nemishavad va do rah-e hal ra nam mibarad.

**Rah-e 2 — dasti export kon** (age nemikhahi `.env` ra dast bezani):

```powershell
$env:UI_PASSWORD = "dev"
$env:PROJECTS_ROOT = "$HOME\clodeck-projects"
npm run dev
```

- `UI_PASSWORD` na-gozashtan → server **fail-closed** bala miyayad va in ra minevisad:
  `UI_PASSWORD is not set: every /api route and both websockets will answer 401 (fail-closed).`
  Yani hich login-i movafagh nemishavad — in bug nist, design ast.
- `PROJECTS_ROOT` na-gozashtan → app bala miyayad vali sidebar khali ast va minevisad:
  `no projects root configured — set PROJECTS_ROOT or projectsRoot in clodeck.config.json`.

`npm run serve` in do ra **ghabl az build** check mikonad (preflight) va age nabashan, aslan build
nemikonad — be jaye inke yek UI-e kharab behet bedahad.

### 3.4 `serve` ra ba launcher bezan, na dasti

`.env` faghat yek **yad-dasht** ast — server khodesh hich dotenv nadarad. Do chi un yad-dasht ra be
environment tabdil mikonand: `start-clodeck.ps1` baraye `serve` (inja), va `npm run dev:env` baraye dev
loop (§3.3). In ra baraye `serve` bezan:

```powershell
.\start-clodeck.ps1     # .env ra mikhanad → env var mikonad → npm run serve
```

Age `ExecutionPolicy` gir dad (`running scripts is disabled on this system`):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned     # yek bar
# ya bedoone taghir-e system:
powershell -ExecutionPolicy Bypass -File .\start-clodeck.ps1
```

Baraye inke har bar Windows bala oumadan khodesh shoroo shavad: yek shortcut az
`start-clodeck.ps1` ra begozar dar `shell:startup`.

Baste kardan: `Ctrl-C` dar hamoon window.

### 3.5 Rag-e daghigh-e Windows

- **Port 3001 gir karde (`listen EACCES: permission denied 127.0.0.1:3001`).** Hyper-V va WSL az
  khodesh range-haye dynamic port reserve mikonan va 3001 oftadan dakhelesh. Bebin:
  `netsh interface ipv4 show excludedportrange protocol=tcp` — va rah-e hal: ya `PORT=3300` (Vite ham
  hamrah-e un move mishavad), ya dar yek shell-e **elevated**: `net stop winnat && net start winnat`.
  Inja hich chiz-e app kharab nist; hata log-e server ham chizi nemigoyad.
- **502 az taraf-e client** yani Vite be backend nareside — dar 99% mavared hamin port-e bala ast.
- Firewall: baraye hamin estefade-e mahali **hich rule-i baz nakon**. Firewall faghat vaghti mohem
  mishavad ke bekhahi az machine-e digar vasl shavi (direct route).

---

## 4) Server-e Linux

> **Mikhai dasti nadavi?** `bash scripts/deploy-clodeck.sh` hamin section-e 4 ra *ba to* mire:
> pish-niaz-ha ra nasb mikone, projects root va password va endpoint va tier-ha ra mipourse, baad
> `/etc/clodeck/clodeck.env` va unit-e systemd ra minevise, port ra dar firewall baz mikone, va
> sabr mikone ta `/healthz` javab bede. Baraye avaz kardan-e yek meghdar, hamino dobare beza.

### 4.1 Pish-niaz

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git python3 make g++
```

### 4.2 Yek user-e dedicated, **na root**

Terminal-e clodeck yek shell-e vaghe-i ast ba hame privilege-e hamoon user-i ke server ra bala
avarde. Root kardan-e server rah-e hal nist, yek moskel-e bozorgtar ast.

```bash
sudo useradd --create-home --shell /bin/bash clodeck
sudo mkdir -p /srv/clodeck-projects && sudo chown clodeck:clodeck /srv/clodeck-projects
```

### 4.3 Nasb va ejra

```bash
sudo -u clodeck -i
git clone <repo> /home/clodeck/clodeck && cd /home/clodeck/clodeck
npm ci                                # ci na install: in deployment ast

mkdir -p ~/.config/clodeck && (umask 077; printf 'yek-password-e-tulani' > ~/.config/clodeck/password)

PROJECTS_ROOT=/srv/clodeck-projects \
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password \
ANTHROPIC_API_KEY=sk-ant-... \
  npm run serve
```

- `UI_PASSWORD_FILE` **faghat** vaghti khande mishavad ke `UI_PASSWORD` set nabashad. Trim mishavad.
- `WEB_ROOT` ra niaz nist set koni: unset, server az working directory bala miravad va build-e khodesh
  ra peyda mikonad va minevisad az koja (`serving the built client from …`).
- `HOST` default `127.0.0.1` ast — yani loopback. In defense in depth ast: tunnel miresad, network
  nemiresad. (In ra **bedoone dalil** avaz nakon.)

Check:

```bash
curl http://127.0.0.1:3001/healthz     # {"status":"ok","build":{"commit":"…","builtAt":"…","dirty":false}}
```

- `status` **aval** ast chon script-haye setup/deploy daghighan `"status":"ok"` ra grep mikonand.
- `build` stamp-e **artifact-i** ast ke run mishavad, na checkout-e git-e kenaresh (ADR 0004). Hamoon
  khatt ro-ye login screen (ghabl az vorood) va sidebar header ham neshoon dade mishavad.
- Dar dev loop `commit` = `dev` va `builtAt` = `null` ast. Dar image-e Docker bedoone
  `--build-arg CLODECK_BUILD_COMMIT=$(git rev-parse HEAD)` `commit` = `unknown` ast. Hich kodoom
  makhfi nemishavand.

### 4.4 Daemoon kardan — systemd

```ini
# /etc/systemd/system/clodeck.service
[Unit]
Description=Clodeck
After=network.target

[Service]
Type=simple
User=clodeck
WorkingDirectory=/home/clodeck/clodeck/server
ExecStart=/usr/bin/node dist/main.js
EnvironmentFile=/etc/clodeck/clodeck.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
# /etc/clodeck/clodeck.env   → chmod 600, owner root
PROJECTS_ROOT=/srv/clodeck-projects
UI_PASSWORD_FILE=/home/clodeck/.config/clodeck/password
ANTHROPIC_API_KEY=sk-ant-...

sudo chmod 600 /etc/clodeck/clodeck.env
sudo systemctl daemon-reload && sudo systemctl enable --now clodeck
sudo journalctl -u clodeck -f
```

**`WorkingDirectory` do bar load-bearing ast:** `dist/main.js` nesbat be un resolve mishavad, va
`clodeck.config.json` ham az hamoon ja khande mishavad (na az repo root).

### 4.5 Chetor az kharej beresam behesh?

| Vaziat | Rah |
|---|---|
| Mahali / test | Hamoon `127.0.0.1:3001` |
| Server bedoone domain, faghat khodam | **SSH tunnel** — hich chiz nasb nemishavad, hich chiz expose nemishavad |
| Server bedoone domain, vali mikham az phone ham beravam | **Direct route**: `HOST=0.0.0.0` + `CLODECK_PUBLIC_URL=http://IP:3001` — **cleartext** |
| Domain daram | **Docker Compose + Caddy** (Let's Encrypt) — tamiz-tarin rah |

**Tunnel:**

```sh
ssh -N -L 3001:127.0.0.1:3001 clodeck@your-server
```

`-N` yani "hich shell-i, faghat port forward". Bad `http://localhost:3001`. Chand nokte:

- Browser-ha `localhost` ra trustworthy midanestand, pas cookie `Secure` mimanad va SSH har byte ra
  encrypt mikonad. Bedoone hich config-i.
- `-o ServerAliveInterval=30 -o ServerAliveCountMax=3` bezar, vagarna sleep-e laptop tunnel ra mikooshad.
- Ghanoon: **hargez `--host 0.0.0.0` be Vite nade.** Vite be `localhost` bind mishavad ke daghighan
  hamoon chizi ast ke tunnel miresad.

**Direct route — va gheymatash:**

```sh
HOST=0.0.0.0 \
CLODECK_PUBLIC_URL=http://203.0.113.10:3001 \
UI_PASSWORD='yek-password-e-tulani' \
PROJECTS_ROOT=/srv/clodeck-projects \
  npm run serve
```

`CLODECK_PUBLIC_URL` tamoom-e trick ast: scheme-e un moshakhas mikonad cookie `Secure` bashe ya na.
`http:` → `Secure` nist → login rooye IP-e kham kar mikonad. **Gheymatash: TLS nadarim, yani password va
har byte-e chat va terminal rooye wire be soorat-e cleartext mire. Server dar startup va login screen
har do un ra migoyad.** Age `CLODECK_PUBLIC_URL` ra nabashe, cookie mesle ghabl `Secure` mimanad.

### 4.6 Docker (age bekhahi)

```sh
docker build -t clodeck .
docker run -d --name clodeck --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  --env-file /etc/clodeck/clodeck.env \
  -v /srv/clodeck-projects:/projects \
  -v clodeck-sessions:/home/node/.claude \
  clodeck
```

- Container ba uid **1000** miziyad → `sudo chown -R 1000:1000 /srv/clodeck-projects`.
- `PROJECTS_ROOT` **dakhel-e** container ast (`/projects`) — na path-e host.
- `-v …:/home/node/.claude` transcript-haye SDK ast, yani tarikhche-e chat az restart jan salem
  mimanad. (Bedoon-e in, har restart history ra miborad.)
- Compose-e kamel (`docker-compose.yml`) `CLODECK_DOMAIN` va `PROJECTS_ROOT` va `ANTHROPIC_API_KEY`
  ra **eijbar** mikonad va password ra az file-e `secrets/ui_password.txt` mikhanad.

---

## 5) Vared kardane API key va baghie etelaat

### 5.1 Aval in ra befahm: `.env` khodesh kar nemikonad

In repo **hich dotenv-i nadarad**. Server faghat environment variable-haye vaghe-i ra mikhanad.
Pas `.env` faghat yek **yad-dasht** ast. Chahar rah ke un yad-dasht be server beresad:

| Rah | Chetor |
|---|---|
| `npm run dev:env` | `.env` ra mikhanad, env var mikonad, `npm run dev` mizanad — baraye dev loop |
| `start-clodeck.ps1` / `start-clodeck.sh` | Hamoon kar, vali `npm run serve` mizanad (build-e production) |
| Docker / compose | Khodesh `.env` ra mikhanad |
| Dasti | Khodet dar shell set mikoni: `$env:UI_PASSWORD = "..."` |

Yani: **har bar `.env` ra edit kardi, launcher ya `dev:env` ra restart kon** (Ctrl-C va dobare). Va age
berah-e dasti `npm run dev` bezani, `.env` ra faramosh kon — un ra nemikhanad.

**In gom-shodan faghat baraye credential saket ast:** `UI_PASSWORD` va `PROJECTS_ROOT`
zood neshoon midahad (login rad mishe, sidebar khali ast). Vali credential — `ANTHROPIC_API_KEY` ya
`ANTHROPIC_AUTH_TOKEN` — hich chizi nemigoyad: app salem be nazar miresad, login kar mikonad, va
**avvalin payam-e chat** hamin ra javab midahad:

```
Not logged in · Please run /login
```

In payam-e khode Agent SDK ast va be `/login`-e clodeck hich rabti nadarad — ma'ni-e vaghe'ish in ast ke
server process aslan credential nadashte. Man daghighan hamin ra 2026-10-16 khordam: `.env` key dasht,
vali `npm run dev` un ra nemikhand va faghat do variable-e dasti be server rasid.

### 5.2 Jadval-e kamel-e variable-ha

| Variable | Default | Kar |
|---|---|---|
| `PROJECTS_ROOT` | — | Folder-i ke immediate child-hash project hastan. Unset → list-e khali, hargez error nist |
| `UI_PASSWORD` | — | Password-e yegane account. Unset/khali → fail-closed (401 rooye hame chi) |
| `UI_PASSWORD_FILE` | — | **Faghat** vaghti `UI_PASSWORD` unset ast. Mohktavayat trim mishavad |
| `PORT` | `3001` | Port-e server. Vite proxy ham hamoon ra mikhanad |
| `HOST` | `127.0.0.1` | Bind address. Loopback = defense in depth. Container `0.0.0.0` midahad |
| `CLODECK_PUBLIC_URL` | — | Origini ke browser mibinad. Faghat **scheme**-ash mohem ast (cookie-e `Secure`) |
| `CLODECK_TRUSTED_PROXIES` | — | Proxy-haye jolo. Login lockout rooye IP-e browser key konad |
| `WEB_ROOT` | — | Folder-e client-e build-shode. Unset → khodesh peyda mikonad |
| `ANTHROPIC_BASE_URL` | — | Endpoint. Khali → `api.anthropic.com` |
| `ANTHROPIC_API_KEY` | — | Credential-e **Anthropic-e khodesh** (SDK in ra mikhanad) |
| `ANTHROPIC_AUTH_TOKEN` | — | Credential-e har endpoint-e digar |
| `ANTHROPIC_MODEL` | — | Model-e default. Khali → endpoint khodesh entekhab mikonad |
| `CLODECK_PROVIDER_<NAME>_BASE_URL` / `_AUTH_TOKEN` / `_MODEL` | — | Yek provider profile (tier ya provider) |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Ja-i ke transcript-ha mimanand = manba-e session history |

`clodeck.config.json` ham hast (faghat `projectsRoot`) baraye kasani ke env var doost nadarand — az
working directory khande mishavad (yani `server/`, na repo root).

### 5.3 Kodam credential? `ANTHROPIC_API_KEY` ya `ANTHROPIC_AUTH_TOKEN`

Ghanoon sade ast:

- **Endpoint = Anthropic-e khodesh** (yani `ANTHROPIC_BASE_URL` khali) → `ANTHROPIC_API_KEY`.
- **Har endpoint-e digar** (DeepSeek, gateway, proxy) → `ANTHROPIC_AUTH_TOKEN`.

Wizard ham daghighan hamin ra minevisad: be endpoint negah mikonad va esm-e motenazer ra miporsad, va
un yeki ra **khali** mikonad — ta key-e yek vendor kenaar-e endpoint-e vendor-e digar naghi moonad.

Mesal-e khodam (factory ke dar `.env` daram):

```sh
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_AUTH_TOKEN=sk-...            # key-e DeepSeek, na Anthropic
```

### 5.4 "Tier" chist va chera monaseb-e man ast

Clodeck faghat **Anthropic Messages API** ra midanad va bas. Anthropic khodesh yeki ast; DeepSeek yek
surface-e `/anthropic` darad; vendor-e digar bayad az yek **translation proxy** ke khodet ejra mikoni
oboor konad.

Yek **provider profile** yek *patch* rooye environment-e server ast. Har chizi ke nagoyi, az
`ANTHROPIC_*`-e server ars mibare. Pas yek endpoint ba do model = do khat:

```sh
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_AUTH_TOKEN=sk-...
CLODECK_PROVIDER_FLASH_MODEL=deepseek-chat       # arzoon, baraye kar-e roozmare
CLODECK_PROVIDER_PRO_MODEL=deepseek-reasoner     # ghavi, baraye design
  npm run serve
```

In do ta **tier** hastan (endpoint va credential ra az server ars mibaran). Estefade: baraye grunt work
model-e arzoon, baraye design model-e ghavi — dar **hamoon project**.

- Esm-e profile normalize mishavad: upper case, va `-` → `_`. Yani `deepseek-flash` va
  `DEEPSEEK_FLASH` **yek** profile hastan.
- **`default` reserve shode ast** baraye environment-e khode server. Esm-e digar bedah.
- Profile-ha **faghat yek bar, dar boot** khande mishavan: ezafe kardan ya avaz kardan = restart.

### 5.5 Provider-e dovom (endpoint-e joda)

Age bekhahi yek vendor-e digar ham dashte bashi, har se key ra bedah:

```sh
CLODECK_PROVIDER_GATEWAY_BASE_URL=https://...
CLODECK_PROVIDER_GATEWAY_AUTH_TOKEN=...
CLODECK_PROVIDER_GATEWAY_MODEL=...
```

### 5.6 Ghanon-e credential — in ra bekhan, mohem ast

> **Endpoint va credential ba ham safar mikonan; model azad ast.**

In yani:

- Ye project mitavanad provider-e khodesh ra dar `.claude/settings.json` **pin** konad.
- Age in file `ANTHROPIC_BASE_URL` ya `ANTHROPIC_AUTH_TOKEN` dashte bashad, SDK un ra key-be-key
  moqadam midanad be environment-e server.
- Clodeck ba un nemijangad: picker migoyad *pinned by this project* va **faghat tier-ha** ra pishnahad
  mikonad (chon esm-e model-e yek vendor dar endpoint-e vendor-e digar hich mani nadarad) va run faghat
  **model** ra miborad. Yani switch-e arzoon/ghavi dakhel-e hamoon project zende mimanad.
- Dalil: age clodeck endpoint-e profile ra kenar-e credential-e project mifrestad, yani key ra be hosti
  midadi ke baraye un sader nashode.

Va yek hoshdar-e mohem:

> **Credential-i ke dar `.claude/settings.json`-e yek project neveshte mishavad, baraye model
> khandanist.** Drawer hich dotfile-i ra filter nemikonad va `Read`-e agent rooye project khodkar
> approve shode ast. Yani key-e dast-neveshte dar project = key-i ke agent-e hamoon project mitavanad
> baz konad. **Credential-e mohem ja-ash environment-e server ast** — una-ji ke hich browser un ra
> nemibinad.

### 5.7 Yek bug-e `.env` — ke dorost shod (2026-10-16)

Ghablan dar `.env`-e man in khat bod:

```
CLODECK_PROVIDER_FLASH,PRO_MODEL=deepseek-flash[1m],deepseek-v4-pro[1m]
```

Comma (`FLASH,PRO`) `_` nist, pas clodeck un ra **yek profile ba esm-e `FLASH,PRO`** mikhond — na do ta
`FLASH` va `PRO`. Yani dar picker yek esm-e ajib bood va hich tier-e dorost-hosele-i nadashtam.

Sabab-e voqooe: dar wizard, prompt yek **esm** mikhahad; neveshtan-e `flash,pro` do ta profile nemisazad.
**Yek esm = yek profile.**

Alan `.env` in ast:

```
CLODECK_PROVIDER_FLASH_MODEL=deepseek-flash[1m]
CLODECK_PROVIDER_PRO_MODEL=deepseek-v4-pro[1m]
```

Va do khatt-e testi-e digar comment shodan — `CLODECK_PROVIDER_DEEPSEEK_MODEL` (value: `flash, pro`) va
`CLODECK_PROVIDER_A_MODEL=deepseek`. Age lazemشان nadari, mitavani az file pakeshun koni (comment-ha
faghat baraye in hastan ke betavani bebin chi bood).

Check-e khodesh: az `server/` yek file-e movaqat bezan ke `listProfiles(process.env)` ra seda bezanad
(environments ra ghabl az un az `.env` load kon). Natije-e man, rooye `.env`-e dorost-shode:

```json
[{"name":"default","shape":"tier"},
 {"name":"FLASH","shape":"tier"},
 {"name":"PRO","shape":"tier"}]
```

Se nokte:

- Hich warning-e `ignoring CLODECK_PROVIDER_…` nayamad — yani hich key-e shekaste-i naghzi nist.
- Har se **tier** hastan: faghat model declare mikonan, pas endpoint va credential ra az
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`-e server ars mibaran. Hamin chiz-e dorost ast.
- Profile-e `default` **model nadarad** (chon `ANTHROPIC_MODEL` dar `.env` nist) — yani endpoint khodesh
  tasmim migirad. Age bekhahi bedani har turn rooye chi raft, log-e server ra bekhan (har run profile va
  model-e khodesh ra log mikonad) ya yek `ANTHROPIC_MODEL` bezar.
- **Agar chat error-e "model na-shenakht" dad:** esm-haye `deepseek-flash[1m]` / `deepseek-v4-pro[1m]`
  shabih-e esm-haye dakheli-e hamin harness hastan. API-e vaghe-i-e DeepSeek dar docs-e khodesh
  `deepseek-chat` va `deepseek-reasoner` ra liste mikonad. Age endpoint un do esm ra nashenakht, hamin
  jay-e avaz-kardan-e un do value ast.

### 5.8 Har taghir = restart

Password dar boot hash mishavad, va profile-ha ham dar boot khande mishavan. Pas:

- Password avaz shod → restart (va **hame session-ha miriZad**).
- Profile ezafe/avaz shod → restart.
- Yek pin dar `.claude/settings.json` avaz shod → **hich restart-i niaz nist** (har turn az no khande
  mishavad).

---

## 6) Kar ba `scripts/setup-clodeck.sh` — marhale be marhale

Wizard yek bash script ast (`/wizard` skill sakhtesh). Kar-e un: hamin marahale dasti ra **ba to**
anjam midahad, har value ra miporsad, va minevisad — vali **hich chiz ra khodesh start nemikonad**.

Ejra: **dakhel-e Git Bash** (rooye Windows in script bash ast):

```bash
cd /d/projects/clodeck/clodeck
bash scripts/setup-clodeck.sh
```

> **Daqiq bashe:** in ra dakhel-e Git Bash bezan. Age dar PowerShell `bash` bezani, Windows momken ast
> WSL ra bala biyarad — va onvaqt script dakhel-e Linux-e joda miziyad va path-ha gij mishavad.

**Kolliyat-e raftar:**

- `TOTAL_STAGES=8`, yani 8 marhale.
- Har marhale screen ra pak mikonad ta faghat step-e jari rooye screen bashe (age output ra pipe koni,
  pak nemikonad ta log khandani bemanad).
- Har ja `Ctrl-C` bezani, hich chiz kharab nemishavad: dobare ke ejra koni, har prompt **value-e
  zakhire-shode ra pishnahad midahad** va `Enter` un ra negah midarad. Pas re-run = rah-e ezafe kardan-e
  tier ya dorost kardan-e yek path.
- Yad-dasht: `ENV_FILE` pishfarz `.env` ast.

### Marhale 1/8 — The checkout

Chek mikonad: script koja zendegi mikonad, `package.json` name = clodeck, Node mojood va ≥ 22.12,
va `node_modules` hast ya na.

```text
▸ Stage 1/8 · The checkout
  This wizard configures the copy of clodeck it lives in: /d/projects/clodeck/clodeck
  the checkout looks like clodeck ✓
  node v22.14.0 ✓
  dependencies are installed ✓
  Press Enter to continue
```

Age `node_modules` nabashad, miporsad `run npm install now (a minute or two)?` — yani in marhale
mohtamelan 1-2 daghighe tool mikeshad. Age Node ghadimi bashe, `exit 1` mikonad (in ra dorost kon va
re-run).

### Marhale 2/8 — The projects root

```text
▸ Stage 2/8 · The projects root
  Every immediate child directory of this path is one project. clodeck keeps
  no database, so the folders in here are the whole registry.
  Projects root (Enter for ~/clodeck-projects): C:\Users\<you>\clodeck-projects
  found it ✓
  ✓ wrote PROJECTS_ROOT → .env
  clodeck.config.json can hold projectsRoot instead; nothing else goes in it.
```

- `Enter` bedoone chiz → pishfarz `~/clodeck-projects`.
- Age folder nabashad miporsad besazad.
- Age folder khali bashe, miporsad yek sample project-e `hello/` besazad.
- **Nokte-ye Windows:** script `cygpath` ra estefade mikonad, pas do nemoodar-e yek path mishavad:
  khode folder ba shekl-e POSIX (`/c/...`) sakhte mishavad, vali **dar `.env` shekl-e Windows
  (`C:\Users\...`) neveshte mishavad** — chon on shekli ast ke node rooye Windows dorost resolve
  mikonad. In hamoon trap-e `PROJECTS_ROOT=D:\...` dar Git Bash ra khamoosh mikonad.

### Marhale 3/8 — The login password

```text
▸ Stage 3/8 · The login password
  Choose the login password: **********
  ✓ wrote UI_PASSWORD → .env
  Hashed once at boot: changing it needs a restart, and a restart drops every session.
```

Input hidden ast (mesle password prompt). **Khali nagozar** — blank = unset = fail-closed (har login
401). Script ta yek value-e gheyr-e khali nagire, dor mizanad.

### Marhale 4/8 — The endpoint (environment-e khode server)

In marhale "default profile" ra set mikonad — hamin chizi ke session-ha rooye un ejra mishavan magar
yeki yek profile-e digar entekhab konad. Browser baz mikonad (rooye Windows ba `explorer.exe`):

```text
▸ Stage 4/8 · The endpoint every run starts on
  ↗ opening https://platform.deepseek.com/
  ↗ opening https://api-docs.deepseek.com/guides/anthropic_api

  Base URL (blank = Anthropic's own api.anthropic.com): https://api.deepseek.com/anthropic
  The API key / token for it: **********
  ✓ wrote ANTHROPIC_AUTH_TOKEN → .env
  ✓ wrote ANTHROPIC_BASE_URL → .env
  Default model (blank = let the endpoint choose):
  left to the endpoint: it answers with whatever model it defaults to.
```

Nokte-ha:

- In safhe-ha-ye ke baz mishavad **DeepSeek** hastan — un mesal-e README ast. Rooye vendor-e digar, un
  ha ra nadide begir va dashboard-e khode vendor ra estefade kon.
- Age Base URL ra **khali** bezari → yani Anthropic-e khodesh → script az **`ANTHROPIC_API_KEY`**
  miporsad (na `AUTH_TOKEN`) va un yeki ra khali mikonad.
- Age credential ra khali bezari: hoshdar midahad ke login/terminal/files kar mikonand vali
  **chat hich javabi nemidanad**.
- Model ra khali bezari → endpoint khodesh tasmim migirad.

### Marhale 5/8 — Tier-ha

```text
▸ Stage 5/8 · Tiers: one endpoint, several models
  Profile name (blank to finish): flash
  Model for FLASH: deepseek-chat
  ✓ wrote CLODECK_PROVIDER_FLASH_MODEL → .env
  Profile name (blank to finish): pro
  Model for PRO: deepseek-reasoner
  ✓ wrote CLODECK_PROVIDER_PRO_MODEL → .env
  Profile name (blank to finish):            ← Enter = tamoom
```

- Esm normalize mishavad: whitespace hazf, upper case, `-` → `_`. Yani `flash` → `FLASH`.
- `default` ra ghabool nemikonad (reserve ast) va miporsad esm-e digar.
- **Yek esm bedah, na chand ta.** `flash,pro` esm-e yek profile ast ba esm-e ajib — na do profile.
  (In eshtebah dar `.env`-e man oftade bood; section 5.7 tozih midahad chetor dorost shod.)
- Tamoom kardan: dar prompt-e esm, bedoone chiz `Enter` bezan.

### Marhale 6/8 — Provider-e dovom (optional)

```text
▸ Stage 6/8 · A second provider (optional)
  Add one? [y/N] n
  skipped: re-run this wizard whenever you want to add one.
```

Age `y` bezani, se chiz miporsad: esm (`gateway`), base URL-e un, key-e un
(`CLODECK_PROVIDER_GATEWAY_AUTH_TOKEN`), va model-e un. Age yeki az in se khali bashe, hich chiz
neveshte nemishavad va sabab ra migoyad — chon do tayi-esh yek profile nist.

### Marhale 7/8 — Launcher-ha

```text
▸ Stage 7/8 · The launchers
  wrote start-clodeck.ps1 ✓
  wrote start-clodeck.sh ✓
  Both are gitignored, as .env is: they are this machine's, not the repo's.
```

Inja maghz-e mozuo ast: server environment variable-haye **vaghe-i** ra mikhanad (dotenv nadarim),
pas `.env` tanha yek record ast. In do file un record ra be environment tabdil mikonand:

- `start-clodeck.ps1` — baraye PowerShell. `.env` ra mikhanad, har khatt ra be `Env:` mibard, va
  `npm run serve` mizanad. (Faghat `\r`-e ezafi ra trim mikonad, chon password mitavanad ba space
  tamoom shavad.)
- `start-clodeck.sh` — baraye bash/Linux. `.env` ra **mikhanad, source nemikonad** — chon yek path-e
  Windows (`C:\Users\…`) dar `source` backslash-hash ra az dast midahad.

Har do gitignored hastan, mesle `.env`.

### Marhale 8/8 — Start it

```text
▸ Stage 8/8 · Start it
  In a NEW PowerShell window — this one has to stay free — run:

      cd C:\Users\<you>\clodeck\clodeck
      .\start-clodeck.ps1

  Press Enter once that line is on screen
```

Script path-e dorost ra ba `cygpath -w` be shekl-e PowerShell midahad (chon `$PWD`-e Git Bash yek
`/c/...` ast ke PowerShell ghabool nemikonad). Bad az inke `Enter` bezani:

- `curl http://127.0.0.1:3001/healthz` ra check mikonad → age `{"status":"ok",…}` bianad, migoyad ✓
- Browser ra rooye `http://127.0.0.1:3001` baz mikonad.
- Chand rahnamaye kootah midahad: project entekhab kon → picker-e balaye composer
  (`running on <model> · <profile>`) entekhab kon → yek turn beferest (baad az turn-e aval picker
  **lock** mishavad: provider-e digar = `New chat` dar header) → rail's Terminal/Files hamoon yek drawer-e
  paeeni ra baz mikonad.
- Va yadavari midahad: project-i ke `.claude/settings.json`-ash endpoint/credential dare, **pinned**
  ast — unja faghat tier-ha pishnahad mishavad va run faghat model ra mibard.

### Kholase: wizard che kari **nemikonad**

- Hich chiz ra start nemikonad (in kar-e tost).
- Hich system service/systemd nasb nemikonad.
- Hich chiz ra dar GitHub set nemikonad (library-e `gh`-ash vojood darad vali marahale un ra seda
  nemizanand).
- `.env` ra dakhel-e process-e jari load **nemikonad** — be hamin dalil marhale 8 migoyad "dar yek
  PowerShell-e **jadid**".

---

## 7) Nokati ke bayad bedoonam (gotchas)

1. **`UI_PASSWORD` unset = hich login-i nist.** Server fail-closed bala miyayad va har `/api` route va
   har do websocket `401` midahad. Yek value-e **khali** ham unset hesab mishavad.
2. **`PROJECTS_ROOT` ghalat = sidebar-e khali, bedoone error.** In design ast. Tell: khatt-e warn-e
   server — `no projects root configured — …` ya `could not read projects root <path>: …`.
3. **Git Bash backslash-ha ra mikhorad.** `PROJECTS_ROOT=D:\work\projects` rooye shell-e Git Bash
   be `D:workprojects` tabdil mishavad. Ya forward slash bedah (`/d/work/projects`), ya az launcher
   estefade kon (ke file ra mikhanad, na source).
4. **Faghat immediate child directory-ha.** Yek level paeentar dide nemishavad; file-haye sade va
   dot-directory-ha (`.git`, `.cache`) ham na. Symlink hesab mishavad, faghat age maghsad-ash dakhel-e
   root bashe.
5. **Rooye `http://<IP>` login mikonam va dobare barmigardam be login screen.** Yani origin ra declare
   nakardi: cookie ba `Secure` ferestade shod, browser un ra andaakht, request-e baadi `401` shod.
   Server **movafaghiat-e login** ra log mikonad — in gij-konandegi-e asli-e in bug ast. Fix:
   `CLODECK_PUBLIC_URL=http://<hamoon chizi ke type kardi>:<port>`. Chizi ke fix **nist**: flag-e
   `--unsafely-treat-insecure-origin-as-secure`.
6. **5 ta login-e ghalat az yek address = 15 daghighe ghfl (429)** — va in ghfl **password-e dorost ra
   ham** rad mikonad. Posht-e proxy bedoone `CLODECK_TRUSTED_PROXIES` hamash yek bucket hastan.
7. **Restart = hame session-ha miriZad.** Session id-ha dar memory-e server zendegi mikonand. Password
   va profile-ha ham dar boot hash/load mishavan, pas taghir = restart.
8. **Rooye Windows port 3001 momken ast gir karde bashe** (Hyper-V/WSL). `PORT=3300` ya
   `net stop winnat && net start winnat`. Dar in halat client **502** midahad va log-e server hich
   nemigoyad.
9. **`npm run dev` rooye `:5173` ast, `npm run serve` rooye `:3001`.** Dar dev, `:3001` faghat API ast —
   safhe nist. Chizi ke baz mikonam hamishe `5173` (dev) ya `3001` (serve) ast.
10. **`npm run dev` `--raw` ra baraye `concurrently` **az gharaz** midahad.** Bedoone un, line-prefixing
    stream-ha import-e Agent SDK-e vaghe-i ra deadlock mikonad: server bala miyayad, hich nemigoyad,
    hargez listen nemikonad, va client 502 midahad. In ra "dorost" nakon.
11. **`shared/` ra ke edit kardi, `npm run build:shared` lazem ast** (ya restart) — server va client un
    ra az `shared/dist` import mikonand.
12. **Terminal yek shell-e vaghe-i ast ba privilege-haye server.** Ba yek user-e unprivileged ejra kon
    (mesle `clodeck`), ya Docker ke az ghabl ba user-e `node` miziyad. **Root = moskel-e bozorgtar.**
13. **Hargez Vite ra ba `--host 0.0.0.0` bala nayar.** Yek dev server bedoone auth-e khodi rooye port-e
    omoomi.
14. **Docker: uid 1000 va path-e dakheli.** `PROJECTS_ROOT=/projects` (path-e dakhel-e container) va
    folder-e host bayad baraye uid 1000 neveshtani bashe, vagarna faghat reading kar mikonad.
15. **Transcript-ha dar `CLAUDE_CONFIG_DIR` (default `~/.claude`) hastan** — session history va resume
    az hamoon ja khande mishavan. In ra az dast bedah, tarikhche raft.
16. **Clodeck hich credential-i ra zakhire/persist/nasazi nemikonad.** Un ra az environment-e to
    mikhanad va be run midahad. Browser hargez yek credential ra nemibinad — vali agent-e yek project
    mitavanad file-e project ra bekhanad (section 5.6).
17. **`.env`, `start-clodeck.*` va `secrets/` gitignored hastan.** Pas key-ha commit nemishavan —
    vali in ham yani in file-ha be repo ta'alogh nadaran va rooye har machine bayad dobare sakhte
    shavan.
18. **Taghirat rooye `main` commit nemishavad** (ghanoon-e repo). Branch aval, va merge faghat ba
    dastoor-e man. Pre-commit hook `typecheck` + `test` + check-e ticket-ha ra mizanad.

---

## 8) Command-ha-ye rab-e-ruz

| Command | Kar |
|---|---|
| `.\start-clodeck.ps1` | Windows: `.env` → environment → build → serve (in ra mizanam) |
| `./start-clodeck.sh` | Hamoon chiz baraye bash/Linux |
| `npm run serve` | Preflight + build + serve. **In deployment ast** |
| `npm run dev` | Server (`tsx watch`) + Vite, do process. Baraye kodesh-nevisi |
| `npm run dev:fake` | Mesle `dev` vali Agent SDK-e fake — kolle chat bedoone API key va bedoone network |
| `npm run build` | Har se package → `dist/` |
| `npm run build:shared` | Faghat `shared` (bad az edit-e `shared/`) |
| `npm test` | Kolle suite (Vitest) |
| `npm run typecheck` | Type-check, bedoone neveshtan-e hich file |
| `npm run e2e` | Playwright — niaz be app-e bala darad |
| `bash scripts/setup-clodeck.sh` | Wizard (section 6) |
| `bash scripts/deploy-clodeck.sh` | Wizard-e **server**: pish-niaz-ha → `/etc/clodeck/clodeck.env` + systemd + firewall + `/healthz` |
| `curl http://127.0.0.1:3001/healthz` | `{"status":"ok","build":{…}}` = bala ast; `build` hamoon khatt-e build ast |

---

## 9) Troubleshooting-e sari

| Alamat | Dalil | Fix |
|---|---|---|
| Login mikonam, barmigardam be login screen | Origin declare nashode (`Secure` cookie) | `CLODECK_PUBLIC_URL=http://<IP>:<port>` ya tunnel |
| Login screen password-e dorost ra rad mikonad | `UI_PASSWORD` unset/khali — ya 429 az lockout | Warn-e boot ra bekhan; 15 daghighe sabr kon |
| Sidebar khali ast | `PROJECTS_ROOT` nareside ya eshtebah | Khatt-e warn-e server; forward slash dar Git Bash |
| Hamash 502 | Vite be backend naresid (port gir) | `PORT=3300` ya `net stop winnat && net start winnat` |
| Create/save kar nemikonad | Folder baraye user-e server neveshtani nist | `chown` be hamoon user / `1000:1000` dar Docker |
| Hame chi kar mikonad joz javab-e chat | Credential nist ya ghalat ast | `ANTHROPIC_API_KEY` ya `_AUTH_TOKEN`; `npm run dev:fake` baraye test |
| `npm install` rooye Linux fail | `node-pty` compile nemishavad | `sudo apt-get install -y python3 make g++` |

---

## 10) Chand kalame dar payan

- **`npm run serve` + launcher = hamishe.** `npm run dev` faghat vaghti ke rooye khode Clodeck kar mikonim.
- Har taghir dar `.env` → restart-e launcher.
- Har taghir dar `.claude/settings.json`-e yek project → hich restart-i niaz nist.
- Aval khatt-haye server ra bekhan. Warning-haye un fix-e khodeshun ra minevisan.
- [`README.md`](../../README.md) manba-e kamel ast; in file rah-e kootah-e Finglish ast.
