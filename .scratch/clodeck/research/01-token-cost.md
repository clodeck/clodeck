# Why the same prompt can look costlier in clodeck than in the Claude Code CLI

**Status:** research note, no application code changed.
**Date:** 2026-10-19.
**Scope:** clodeck `server` on the `docs/clodeck-token-cost-research` branch,
`@anthropic-ai/claude-agent-sdk` **0.3.296** (`server/package.json:19`), which
bundles Claude Code **2.1.296** (`node_modules/@anthropic-ai/claude-agent-sdk/manifest.json`);
the CLI on this machine is **2.1.303**.

Confidence labels used below:

- **VERIFIED** — read from repo source, the pinned SDK's types, official docs, or
  the machine's own environment/transcripts.
- **HYPOTHESIS** — a mechanism that follows from the facts but was not directly
  observed on the user's clodeck turns.
- **UNVERIFIED** — no primary source found; do not treat as fact.

---

## TL;DR — ranked causes

| Rank | Cause | Confidence | What it can explain | Quickest confirmation |
|---|---|---|---|---|
| 1 | **The two paths may not be running the same model or endpoint.** On this machine the *user-level* environment is `ANTHROPIC_MODEL=auto/best-free` + `ANTHROPIC_BASE_URL=http://localhost:20128`; the *process sandcastle* environment (and `.sandcastle/.env`) is `deepseek-flash[1m]` + `https://api.deepseek.com/anthropic`. The CLI on Windows inherits the user env; clodeck inherits whatever launched its server. | Env facts **VERIFIED**; which env the clodeck server actually inherited is **HYPOTHESIS** | Different provider, different tokenizer, different output/thinking behaviour, and a completely different price. This alone can make the comparison apples-to-oranges. | Read the server's own `turn on profile …` log line (it prints the model and which keys were sent) and compare with `claude -p "…" --output-format json` → `modelUsage` keys. |
| 2 | **clodeck's displayed `$` is a client-side estimate priced with Claude Opus 5.5 list rates for an unrecognised DeepSeek model.** The SDK's `total_cost_usd`/`costUSD` is not a bill; for a model it does not know, `costUSD` is "a guess at the default model's rate". The recorded estimates in this machine's transcripts reproduce Opus 5.5 rates **exactly** ($4/M input, $20/M output, $0.20/M cache read), and are **9×–82×** the actual DeepSeek price for the same token counts. | **VERIFIED** by exact arithmetic on recorded `modelUsage` plus SDK type docs | The "more money" impression, even when the token counts are ordinary. clodeck shows this estimate prominently after every turn and never shows the real token/cache breakdown. | Log the `result` message's `modelUsage[*].costUSD` next to the same counts priced from DeepSeek's published rates. |
| 3 | **clodeck starts a fresh `query()` for every send; the CLI keeps one conversation.** There is no automatic resume: the resume target is armed only by History or by the result-line resume button, and the result line offers it only on `error_max_turns` / `error_max_budget_usd`. A normal clodeck "chat" is therefore a series of one-shot sessions, while the CLI's warm session reads its whole prior prefix from cache. If the user does resume, the displayed `total_cost_usd` is the session's **whole** spend, not that turn's. | Code **VERIFIED**; actual cost impact **HYPOTHESIS** | Less cache reuse, repeated exploration for follow-up questions, and a cumulative dollar figure that grows on every resumed turn. | Compare the `session_id` on each turn's `init`/`result`; compare consecutive resumed `result.total_cost_usd` values with the per-turn `result.usage`. |

The three non-obvious conclusions:

1. **DeepSeek's Anthropic-compatible endpoint does cache** — the docs say
   `cache_control` is "Ignored", but this machine's DeepSeek transcripts report
   `cache_read_input_tokens` in the tens of millions and
   `cache_creation_input_tokens` = 0. The cache is DeepSeek's automatic disk
   cache, not Anthropic's explicit breakpoints. The problem is not "no caching";
   it is the **hit/miss mix**, and the fact that the SDK prices those hits at
   Opus's cache-read rate.
2. **The SDK path sends a *smaller* prompt than the CLI** by default: omitting
   `systemPrompt` selects the SDK's minimal prompt, not the `claude_code` preset,
   and `settingSources: ['project']` drops user-level CLAUDE.md, plugins, and
   hooks. On a same-model comparison these should make clodeck *cheaper* on
   input, not dearer. They are not a cause of higher token counts by themselves.
3. **clodeck's UI has no token display at all.** It reads only
   `result.total_cost_usd`; `usage` and `modelUsage` are present on the wire at
   runtime but are not in the shared type and are never read by the client. Any
   "more tokens" impression therefore comes from the provider dashboard, a raw
   log, or a different definition of "input tokens" — not from clodeck's UI.

---

## 1. What clodeck actually sends to the Agent SDK

The only place the SDK is configured is `server/src/sdk/anthropic.ts`. Every send
builds a fresh `query()` from a prompt string:

- `server/src/sdk/anthropic.ts:86` — `sdkQuery({ prompt: input.prompt, options })`.
- `server/src/ws/turn-manager.ts:153-165` — `provider.query({ cwd, prompt, … })`
  is called once per `send_prompt`; the run is closed when its message stream
  ends (`turn-manager.ts:423-429`).
- There is no streaming-input loop: clodeck never calls `query()` once and feeds
  it multiple user messages. One user message = one `query()`.

The complete option set (`server/src/sdk/anthropic.ts:100-123`):

| Option | clodeck value | Source | Token/cost relevance |
|---|---|---|---|
| `cwd` | canonical project path | `anthropic.ts:102` | Project context; CLAUDE.md loading depends on it. |
| `includePartialMessages` | `true` | `anthropic.ts:104` | **None.** Adds raw `stream_event` deltas for the live bubble; billing is per API request, not per event. |
| `allowedTools` | `['Read', 'Glob', 'Grep']` | `anthropic.ts:106` | **No prompt-size effect.** The SDK documents this as tools that are "auto-allowed without prompting"; to remove tools from context use `disallowedTools`/`tools` (`sdk.d.ts:1582-1589`, `1604-1609`). The full built-in tool set is still sent. |
| `settingSources` | `['project']` | `anthropic.ts:107` | Loads project `.claude/settings.json` and project CLAUDE.md only; **not** user-level settings/CLAUDE.md (`sdk.d.ts:2263-2271`; <https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts>). This is *less* context than the CLI default. |
| `permissionMode` | `'default'` unless the caller sets one | `anthropic.ts:108` | Permission prompts, not token billing. |
| `systemPrompt` | **not set** | absent from `anthropic.ts:100-123` | SDK **minimal** prompt, not the `claude_code` preset. This is *shorter* than the CLI's system prompt. |
| `maxTurns` | **not set** | absent | No cap, same as the CLI's default ("No limit by default", <https://code.claude.com/docs/en/cli-reference>). |
| `maxThinkingTokens` | **not set** | absent | Model/CLI default applies. No clodeck-specific thinking budget. |
| `model` (SDK option) | **not set** | absent | The model arrives through the environment: `providerEnv()` sets `ANTHROPIC_MODEL` (`anthropic.ts:149-152`). |
| `env` | absent for the `default` profile; for a profile, a **full copy of `process.env`** with `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` overlaid | `anthropic.ts:140-154`; `turn-manager.ts:159-161` | This is the provider-selection seam; see §4. |
| `resume` / `forkSession` / `continue` | only when a resume target was armed for this one send | `anthropic.ts:117-119`; `turn-manager.ts:147-149`, `359-371` | Otherwise a brand-new session. See §5. |
| `canUseTool` | the bus's approval callback | `anthropic.ts:120` | Permission only. |

### Start/fresh-session behaviour

`provider.query()` is called with `resumeInput(target)`, and `target` is the
project's `state.resume`, which is consumed and cleared on the same send
(`turn-manager.ts:147-149`). The only writers of that target are:

- `dispatchFrame`'s `case 'resume'` (`server/src/ws/bus.ts:149-152`), which comes
  from `useChat.resume` (`web/src/chat/useChat.ts:166-174`) and is called by
  History's `onResume` (`web/src/chat/ChatPanel.tsx:208-214`, `228-231`) or by
  the result-line resume affordance;
- that result-line affordance appears only when `result.canResume` is true, and
  `canResume` is true only for `error_max_turns` and `error_max_budget_usd`
  (`web/src/chat/reducer.ts:417`, `431`).

So after a **successful** turn in clodeck there is no "continue this session"
button in the live footer. A second message sent from the composer is a new
`query()` with no `resume`, i.e. a new SDK session. This is the intended design
recorded in `spec-02-chat-transport.md` ("`resume` … pompt nemiferestad — send-e
ba'di ba target-e resume ejra mishe") and ticket 11
(`.scratch/clodeck/issues/11-web-history-resume.md`), but it is easy to miss
when comparing against the CLI's single long-lived conversation.

### Client-side prompt contents

The client does not append attachments, file contents, or extra context:

- The wire payload is exactly `{ prompt, profile? }`
  (`shared/src/protocol.ts:113-125`).
- `useChat.sendPrompt` trims and sends that string
  (`web/src/chat/useChat.ts:138-147`).
- The composer sends the textarea value and nothing else
  (`web/src/chat/Composer.tsx:88-94`).
- The prompt is `.trim()`ed; the CLI sends the prompt as given. That can change a
  handful of whitespace tokens, never more.

**Conclusion:** there is no clodeck-specific client-side prompt bloat to find.

---

## 2. Prompt caching: what is actually happening

### 2.1 How the SDK/CLI activates caching

- The Agent SDK/Claude Code manage prompt caching **automatically**: "The Agent
  SDK automatically uses prompt caching to reduce costs on repeated content. You
  do not need to configure caching yourself."
  (<https://code.claude.com/docs/en/agent-sdk/cost-tracking#track-cache-tokens>)
- At the API level, caching is explicit (`cache_control` breakpoints or top-level
  automatic caching); `ephemeral` is the only cache type and the default TTL is
  5 minutes. Cache writes cost 1.25× (5-minute) or 2× (1-hour) input; cache reads
  cost 0.1× input for most models, with documented exceptions (Opus 5.5 and
  Sonnet 5.5 use 0.05×).
  (<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>)
- The usage fields mean:
  - `cache_creation_input_tokens` — tokens **written** to the cache this request.
  - `cache_read_input_tokens` — tokens **read from** the cache this request.
  - `input_tokens` — tokens **neither read from nor written to** the cache.
  - Total input = `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`.
  (<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>)
- Claude Code's own guide says a custom `ANTHROPIC_BASE_URL`/gateway decides
  what stays cached: if the gateway **removes the markers while returning
  success**, "your entire conversation history bills as uncached input on every
  turn."
  (<https://code.claude.com/docs/en/prompt-caching>)

### 2.2 What DeepSeek's Anthropic-compatible endpoint does

The compatibility table marks `cache_control` as **"Ignored"** everywhere it
appears (tools, text blocks, `tool_use`, `tool_result`), and does not document
`cache_creation_input_tokens` / `cache_read_input_tokens`
(<https://api-docs.deepseek.com/guides/anthropic_api>). That looks like the
"markers removed while returning success" case above.

But the empirical evidence on this machine says otherwise:

- Six recent `.jsonl` transcripts under `C:\Users\<you>\.claude\projects` were
  aggregated by reading only `.message.model` and `.message.usage` (no prompt
  content). All assistant entries had usage. Examples:
  - `deepseek-flash`, this repo's subagent transcript:
    `input_tokens` 918,091, `output_tokens` 32,873,
    `cache_read_input_tokens` **12,702,336**, `cache_creation_input_tokens` **0**.
  - `deepseek-flash`, parent session:
    342,473 input, 65,280 output, **7,796,352** cache read, 0 cache creation.
  - `deepseek-v4-pro`, a large session:
    697,580 input, 732,931 output, **176,926,464** cache read, 0 cache creation.
- A recorded `modelUsage` entry from a `deepseek-v4-pro[1m]` session:
  `inputTokens 198,091`, `outputTokens 264,720`,
  `cacheReadInputTokens 79,014,784`, `cacheCreationInputTokens 0`,
  `costUSD 21.8897208`.

**VERIFIED empirical conclusion:** DeepSeek's automatic disk cache is active on
the Anthropic-compatible route and is reported through Anthropic's
`cache_read_input_tokens` field. `cache_control` is ignored, but caching is not
absent. `cache_creation_input_tokens` is always 0, which is consistent with
DeepSeek not modelling cache writes the way Anthropic does. The DeepSeek KV-cache
guide documents the native mechanism as on by default ("enabled by default for
all users") and reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
(<https://api-docs.deepseek.com/guides/kv_cache>); it does not describe the
Anthropic-compatible mapping, so the mapping itself is **UNVERIFIED** in the docs
but **VERIFIED empirically** here.

### 2.3 Why the hit/miss mix still differs between the two paths

DeepSeek prices a cache **hit** 30–50× cheaper than a cache **miss**:

| Model | Input, cache hit (peak / off-peak) | Input, cache miss (peak / off-peak) | Output (peak / off-peak) |
|---|---:|---:|---:|
| `deepseek-flash` | $0.003 / $0.006 | $0.15 / $0.30 | $0.60 / $1.20 |
| `deepseek-v4-pro` | $0.022 / $0.044 | $0.66 / $1.32 | $1.98 / $3.96 |

(USD per 1M tokens; off-peak is half of peak; peak is 01:00–04:00 and
06:00–10:00 UTC, Mon–Fri. <https://api-docs.deepseek.com/quick_start/pricing>)

The CLI's interactive session keeps a growing prefix: each turn re-sends the
whole conversation, but the unchanged prefix is a cache **read** and only the new
exchange is a **miss**. clodeck's fresh sessions re-send the static prefix
(system + tools) but carry **no prior conversation**, so:
- there is no large conversation prefix to read from cache on a normal second
  message;
- a follow-up question loses the earlier context, so the model may re-read files
  and re-run tools to recover it (a **HYPOTHESIS**, but the natural consequence
  of one-shot sessions).

The static prefix itself can still hit across clodeck sessions if it is
byte-identical and within the cache lifetime; the practical question is how much
of each request is a hit versus a miss, not whether caching exists.

---

## 3. The dollar figure is an estimate — and on DeepSeek it is Opus-priced

### 3.1 The SDK says so itself

> "The `total_cost_usd` and `costUSD` fields are client-side estimates, not
> authoritative billing data. The SDK computes them locally from a price table
> bundled at build time, unless a `modelPricing` table is in effect. They can
> drift from what you are actually billed when: pricing changes; the installed
> SDK version does not recognize a model; billing rules apply that the client
> cannot model."
> — <https://code.claude.com/docs/en/agent-sdk/cost-tracking#estimates-not-billing>

The pinned SDK's type says what happens for an unknown model ID:

> `costBasis?: 'list' | 'managed' | 'unknown'` … `'unknown' — no pricing row and
> no built-in price matched the model ID, so costUSD is a guess at the default
> model's rate`.
> — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1458-1461`

The default model is Opus 5.5 for Pro/Max/Team/Enterprise and API accounts
(<https://code.claude.com/docs/en/model-config>). `deepseek-flash[1m]` and
`deepseek-v4-pro[1m]` are not Claude model IDs, so no built-in row matches them.

### 3.2 The arithmetic is exact

The recorded `modelUsage` costs are reproduced **exactly** by Opus 5.5 list
rates: **$4/M input, $20/M output, $0.20/M cache read**.

| Recorded model | Input | Output | Cache read | Recorded `costUSD` | Opus 5.5 arithmetic | Match |
|---|---:|---:|---:|---:|---:|---|
| `deepseek-flash[1m]` | 61,081 | 6,851 | 303,360 | 0.442016 | 61,081×4/1e6 + 6,851×20/1e6 + 303,360×0.2/1e6 = **0.442016** | exact |
| `deepseek-flash[1m]` | 197,133 | 177,230 | 16,182,400 | 7.569612 | **7.569612** | exact |
| `deepseek-v4-pro[1m]` | 198,091 | 264,720 | 79,014,784 | 21.8897208 | **21.8897208** | exact |
| `deepseek-v4-pro[1m]` | 140,798 | 127,762 | 6,092,800 | 4.336992 | **4.336992** | exact |

Against DeepSeek's published peak rates, the same token counts cost:

| Recorded model | Estimated `costUSD` | Actual DeepSeek, peak | Ratio | Actual DeepSeek, off-peak | Ratio |
|---|---:|---:|---:|---:|---:|
| `deepseek-flash[1m]` (61k case) | 0.442016 | 0.01418283 | **31.2×** | 0.007091415 | **62.3×** |
| `deepseek-flash[1m]` (197k case) | 7.569612 | 0.18445515 | **41.0×** | 0.092227575 | **82.1×** |
| `deepseek-v4-pro[1m]` (198k case) | 21.8897208 | 2.393210908 | **9.1×** | 1.196605454 | **18.3×** |
| `deepseek-v4-pro[1m]` (140k case) | 4.336992 | 0.47993704 | **9.0×** | 0.23996852 | **18.1×** |

The actual-cost columns use the published `deepseek-flash` / `deepseek-v4-pro`
rates above. The `[1m]` suffix is not documented on the pricing page; if it is a
different SKU with different rates, the ratios change (**UNVERIFIED** for the
exact alias). The point stands: the recorded estimate is a Claude-price guess,
not a DeepSeek bill.

### 3.3 clodeck shows the estimate and nothing else

- The shared `result` mirror includes only `total_cost_usd` — no `usage`, no
  `modelUsage` (`shared/src/sdk.ts:296-324`).
- The server forwards the real SDK message unchanged (`server/src/sdk/mirror.ts:109-117`),
  so those fields are actually on the WebSocket at runtime, outside the type.
- The client reads only `message.total_cost_usd` into `TurnResult.costUsd`
  (`web/src/chat/reducer.ts:408-424`) and renders it as
  `Turn complete · $0.XXXX` (`web/src/chat/ChatPanel.tsx:398-403`).
- No `usage`, `cache_read`, `cache_creation`, `input_tokens`, or `output_tokens`
  is read anywhere under `web/src` (grep; the only hits are tests and
  `total_cost_usd`).

So the only number a clodeck user sees is the Opus-priced estimate. That is the
single most direct explanation for a "more money" impression.

---

## 4. Is it even the same model on both sides?

The model is chosen by the SDK subprocess environment, not by a clodeck option.

### 4.1 The precedence rules

- Claude Code model precedence: `/model` > `--model` > `ANTHROPIC_MODEL` >
  settings `model` > `ANTHROPIC_DEFAULT_MODEL`
  (<https://code.claude.com/docs/en/model-config>).
- clodeck's `providerEnv()` sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  and `ANTHROPIC_MODEL` from the resolved provider profile
  (`server/src/sdk/anthropic.ts:140-154`). The `default` profile resolves to
  whatever the server process already has (`server/src/profiles.ts:370-376`);
  the `FLASH`/`PRO` profiles overlay their declared keys.
- `settingSources: ['project']` means the **user-level** `settings.json` `model`
  is not loaded in clodeck at all (user source excluded,
  `sdk.d.ts:2263-2271`). The CLI loads it by default.
- Projects can pin `.claude/settings.json` `env`, and that file outranks the
  server environment per key; clodeck deliberately lets it (`server/src/project-pin.ts:11-15`).

### 4.2 What this machine actually has

Environment inspection on 2026-10-19 (values redacted where they are credentials):

| Source | `ANTHROPIC_BASE_URL` | `ANTHROPIC_MODEL` | credential |
|---|---|---|---|
| **User** (inherited by a normally launched CLI) | `http://localhost:20128` | `auto/best-free` | set |
| **Process** (this agent's shell; also `.sandcastle/.env:9-11`) | `https://api.deepseek.com/anthropic` | `deepseek-flash[1m]` | set |
| Machine | unset | unset | unset |

Also:

- `C:\Users\<you>\.claude\settings.json` has `"model": "tllm/claude_haiku_3_5"`,
  but `ANTHROPIC_MODEL` outranks settings, so a CLI with the user env uses
  `auto/best-free`.
- `claude auth status --json` reports `authMethod: "oauth_token"`,
  `apiProvider: "firstParty"`. clodeck's DeepSeek runs use
  `ANTHROPIC_AUTH_TOKEN`, which the README says is the credential rule for any
  non-Anthropic endpoint (`README.finglish.md:373-388`).

**What is VERIFIED:** the CLI's *user-level* environment and the *process*
environment (and `.sandcastle/.env`) point at different endpoints and models.
`auto/best-free` is not a DeepSeek or Anthropic model ID; it is an alias, almost
certainly a local router at `localhost:20128`. `tllm/claude_haiku_3_5` is also an
alias.

**What is HYPOTHESIS:** which environment the clodeck server actually inherited.
`npm run dev` does not read `.env` (the README says only `dev:env`/the launchers
do, `README.finglish.md:328-336`), and the root `.env` is currently absent; a
server launched from a normal PowerShell would inherit the **User** env, i.e. the
same `auto/best-free` endpoint as the CLI. A server launched from the sandcastle
or with a profile would inherit the DeepSeek values. The server log resolves it.

### 4.3 The server already logs the answer

Every turn starts with:

```
turn on profile <name> · model <model-or-"the endpoint decides"> · sent: <keys> · <cwd>
```

(`server/src/ws/turn-manager.ts:137`, formatted by `describeRun` at
`turn-manager.ts:326-336`; the log never prints the credential, only its name).

Compare that line with the CLI's:

```sh
claude -p "same prompt" --output-format json
# inspect .modelUsage keys (and .total_cost_usd) in the JSON
```

or `/status` / `/model` in an interactive session. If the model names or
endpoints differ, the token/cost comparison is not measuring the same thing.

### 4.4 Why a model mismatch is enough by itself

Different models differ in tokenizer, tendency to think, output verbosity, and
price. The DeepSeek pricing page alone spans a 4.4× input-miss and 3.3× output
gap between Flash and Pro; a free router alias can be cheaper still. No
clodeck-side option can compensate for comparing different models.

---

## 5. Turn/session shape and the cumulative-total trap

### 5.1 Fresh query per send

- `sendPrompt` creates one `query()` per user message
  (`turn-manager.ts:153-165`).
- `resume` is consumed by exactly one send and then cleared
  (`turn-manager.ts:147-149`).
- There is no automatic re-arm of `resume` on `turn_ended`; the reducer only
  clears the target (`web/src/chat/reducer.ts:232-234`), and the UI offers a
  resume only on the two cap errors (`reducer.ts:431`).

Therefore, unless the user opens History and resumes, every message is its own
SDK session. Confirm it by logging `session_id` from each `system/init` or
`result`: a normal clodeck chat shows a **new** id per message; the CLI's
interactive session keeps one.

### 5.2 Resume reports the whole session's spend

The cost-tracking doc is explicit:

> "A call that resumes a session also counts the session's earlier spend."
> "Each result already includes the session's earlier spend. Read the latest
> result for the session total; summing results double-counts the restored
> spend."
> — <https://code.claude.com/docs/en/agent-sdk/cost-tracking>

clodeck stores that number as `TurnResult.costUsd` and renders it after every
turn with no "cumulative" label (`web/src/chat/ChatPanel.tsx:402`). If the user
resumes a session repeatedly, the same prompt appears to cost more each time
because the displayed number is the session total, not the turn's delta. The
per-turn number is `result.usage` (main loop only) or the difference between
consecutive `modelUsage` totals; clodeck reads neither.

### 5.3 What this does *not* mean

A fresh session is not automatically more input tokens than a resumed one. It
carries no history, so its prompt is smaller. The real risks are (a) a worse
cache-hit mix because the long stable prefix is absent, and (b) re-exploration
when a follow-up loses the earlier context. Both are **HYPOTHESES** whose size
depends on the task; the session-id check tells you whether they apply.

---

## 6. Claude Code CLI defaults, for comparison

| Area | CLI default | clodeck's SDK path | Expected token direction |
|---|---|---|---|
| System prompt | `claude -p` uses the full Claude Code system prompt (<https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts>) | SDK minimal default because `systemPrompt` is omitted (`anthropic.ts:100-123`) | clodeck **smaller** |
| Settings sources | user + project + local, matching CLI defaults (`sdk.d.ts:2267-2269`) | `['project']` only (`anthropic.ts:107`) | clodeck **smaller** (no user CLAUDE.md, plugins, hooks) |
| CLAUDE.md | project + user | project only (`settingSources` controls this; <https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts>) | clodeck **smaller** |
| Tools | full default set; `--allowedTools` pre-approves, `--tools` restricts (<https://code.claude.com/docs/en/cli-reference>) | full default set; `allowedTools` pre-approves (`sdk.d.ts:1582-1589`) | same |
| `max-turns` | no limit by default | no `maxTurns` | same |
| Thinking | on by default; thinking tokens billed as output; `MAX_THINKING_TOKENS` can lower a fixed budget (<https://code.claude.com/docs/en/costs>) | no `maxThinkingTokens`/`thinking`/`effort`; CLI defaults apply | same unless settings differ |
| Compaction | automatic near the context limit | same harness; only relevant when a session is resumed | same |
| Model selection | `/model` > `--model` > `ANTHROPIC_MODEL` > settings `model` | env only (`ANTHROPIC_MODEL` from the profile), user settings excluded | **may differ** |
| Cost display | `/usage` shows `input`, `output`, `cache read`, `cache write` separately, and says subscribers' session cost is "not relevant for billing"; spinner count is output only (<https://code.claude.com/docs/en/costs>) | only `total_cost_usd` | **different definitions** |

The two "smaller" rows matter: on the same model, clodeck's one-shot prompt should
not contain *more* system/setting text than the CLI's. If the user sees more
input tokens in clodeck, the likely explanations are the model/provider, the
definition of "input tokens" (cache reads counted separately), or the
re-exploration caused by losing conversation context — not the SDK options.

---

## 7. Ruled out as direct causes

| Suspect | Verdict | Evidence |
|---|---|---|
| `includePartialMessages: true` | **No billing effect.** It adds raw stream events for the live bubble; the API request is the same. | `anthropic.ts:104`; SDK type `sdk.d.ts:1863-1867`; cost-tracking doc's streaming section. |
| `allowedTools: ['Read','Glob','Grep']` | **No prompt-size effect.** They are auto-allowed, not removed from context; the full tool set is still sent. | `anthropic.ts:106`; `sdk.d.ts:1582-1589`; CLI reference's `--allowedTools` vs `--tools`. |
| `permissionMode: 'default'` | **No token effect.** Changes who approves tools. | `anthropic.ts:108`. |
| `maxTurns` unset | **Same as CLI default** (no limit). | `sdk.d.ts:1928-1932`; CLI reference. |
| `maxThinkingTokens` unset | **Same as CLI default.** No clodeck-specific thinking budget. | `sdk.d.ts:1919-1927`. |
| Client attachments / file contents | **None sent.** | `shared/src/protocol.ts:113-125`; `useChat.ts:138-147`; `Composer.tsx:88-94`. |
| Prompt trimming | **At most a few whitespace tokens.** | `useChat.ts:140-144`. |
| "DeepSeek does not cache at all" | **False on this deployment.** `cache_control` is ignored, but `cache_read_input_tokens` is populated in the transcripts. | DeepSeek compat docs + local transcripts (§2.2). |
| "clodeck reports only raw input tokens while the CLI reports cost including cache reads" | **Not what clodeck does.** clodeck reports only a dollar estimate; it does not report tokens at all. | `ChatPanel.tsx:402`; `reducer.ts:413`; grep of `web/src`. |

---

## 8. Concrete confirmation checklist

Run these on the deployment; none requires changing committed code.

1. **Identify the model and endpoint clodeck actually used.** Read the server
   log line `turn on profile … · model … · sent: … · <cwd>`
   (`turn-manager.ts:137`). The `sent:` list names `endpoint`, `credential`,
   `model`; the credential itself is never printed.
2. **Identify the CLI's model and cost.** Run the same prompt with
   `claude -p "<prompt>" --output-format json` and inspect:
   - `modelUsage` keys (the model(s) that actually ran),
   - `total_cost_usd`,
   - each entry's `costUSD`, `inputTokens`, `outputTokens`,
     `cacheReadInputTokens`, `cacheCreationInputTokens`, `costBasis`,
     `canonicalModel`, `provider`.
   The CLI reference documents `--output-format json`; the cost-tracking doc's
   "Break down usage per model" example reads the same fields.
3. **Inspect clodeck's per-turn usage.** The server already receives the real
   `result` message with `usage` and `modelUsage`
   (`sdk.d.ts:5737-5748`; `mirror.ts:109-117` forwards it untyped). Temporarily
   log, in `pump` on `message.type === 'result'`:
   `message.total_cost_usd`, `message.usage`, `message.modelUsage`. Do not
   commit the log. This is the smallest change that answers "what did this turn
   actually count and how was it priced?".
4. **Inspect the session JSONL.** In `~/.claude/projects/<project>/<session>.jsonl`,
   for each assistant entry print only:
   `.message.model`, `.message.usage.input_tokens`,
   `.message.usage.output_tokens`,
   `.message.usage.cache_read_input_tokens`,
   `.message.usage.cache_creation_input_tokens`.
   Compare the cache-read/miss ratio between a clodeck session and a CLI
   session on the same model. (The local aggregation in §2.2 used exactly this
   method and printed no prompt text.)
5. **Compute the real DeepSeek cost.** Multiply the transcript sums by the
   published rates in §2.3 and compare with the recorded `costUSD` /
   `total_cost_usd`. If the ratio is ~9–82×, cause #2 is confirmed.
6. **Check the session id per turn.** Log `session_id` from `system/init` and
   `result`. If it changes on every composer send, clodeck is not resuming and
   cause #3's cache/context mechanism applies.
7. **Check resume totals.** If the user resumes, print consecutive
   `result.total_cost_usd` values alongside `result.usage`. A growing total with
   a roughly stable per-turn usage is the cumulative-session trap
   (`ChatPanel.tsx:402`).
8. **Compare like with like on tokens.** The API defines `input_tokens` as
   *uncached* input; cache reads are separate. The CLI's `/usage` shows them on
   separate lines. Do not compare a provider's "prompt tokens" (which may
   include cache hits) with the CLI's `input` line, or a spinner's output-only
   count with a turn's total cost.

---

## 9. Open questions / unverified

- **Which environment the clodeck server inherited.** The User env and the
  Process/`.sandcastle` env differ; only the server log or the process's own
  `/proc`-equivalent tells you which one a given run used. **UNVERIFIED for the
  specific clodeck run.**
- **Whether `[1m]` aliases are priced exactly like the published
  `deepseek-flash` / `deepseek-v4-pro` rows.** The pricing page does not list the
  suffix. The ratios in §3.2 are therefore approximate for the alias; the
  estimate-vs-DeepSeek gap direction is robust. **UNVERIFIED.**
- **The exact mapping from DeepSeek's automatic cache to Anthropic's
  `cache_read_input_tokens`.** The docs do not state it; the transcripts show it
  working. **VERIFIED empirically, UNVERIFIED in docs.**
- **The size of the behavioural effect of the minimal system prompt and the
  missing user hooks/plugins.** Both point at a different prompt, not
  necessarily more tokens. A controlled test (same model, same prompt, with and
  without `systemPrompt: { type: 'preset', preset: 'claude_code' }`, and with
  `settingSources: ['user','project']`) would measure it. **HYPOTHESIS.**
- **Whether the CLI comparison is a subscription session.** `claude auth status`
  reports `oauth_token`/`firstParty`; the official cost page says a subscriber's
  session cost "isn't relevant for billing purposes". If the CLI draws on a
  subscription and clodeck draws on a metered DeepSeek key, the dollar
  comparison is not a comparison of bills. **HYPOTHESIS pending the gateway/
  auth check.**

---

## Sources

### Repository (this branch)

- `server/src/sdk/anthropic.ts` — `startRun`, `toSdkOptions`, `providerEnv`.
- `server/src/sdk/provider.ts` — the `SdkRunInput` surface.
- `server/src/ws/turn-manager.ts` — one `query()` per send, resume target,
  the per-turn profile/model log, cumulative result handling.
- `server/src/ws/bus.ts` — `send_prompt`/`resume` dispatch.
- `server/src/sessions.ts` — session list/transcript.
- `server/src/profiles.ts` — profile resolution and inherited `ANTHROPIC_*`.
- `server/src/config.ts` — environment reading and the one definition of "unset".
- `server/src/project-pin.ts` — `.claude/settings.json` `env` precedence.
- `shared/src/protocol.ts:113-125` — `SendPromptPayload`.
- `shared/src/sdk.ts:296-324`, `:108` — the result/assistant mirror (no
  `usage`/`modelUsage` on `result`; `usage?: unknown` on the assistant message).
- `web/src/chat/useChat.ts:138-147` — `sendPrompt`.
- `web/src/chat/ChatPanel.tsx:208-214`, `253-260`, `398-403` — resume
  affordances and the cost line.
- `web/src/chat/reducer.ts:408-424`, `431` — `costUsd` and the two resumable
  subtypes.
- `web/src/chat/Composer.tsx:88-94` — the prompt is the textarea text.
- `server/package.json:19` — SDK `0.3.296`.
- `.sandcastle/.env:9-11` — base URL/model names (credential redacted).
- `README.finglish.md:328-336`, `363-367`, `373-388`, `465-466` — the
  documented env/provider setup.
- `.scratch/clodeck/spec-02-chat-transport.md` and
  `.scratch/clodeck/issues/11-web-history-resume.md` — the intended
  one-send-per-query/resume semantics.

### Pinned SDK types (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)

- `:1582-1589` — `allowedTools` is auto-allow, not a restriction.
- `:1604-1609` — `disallowedTools` removes tools from context.
- `:1863-1867` — `includePartialMessages`.
- `:1919-1932` — `maxThinkingTokens` / `maxTurns`.
- `:2263-2271` — `settingSources` omitted = all sources; `'project'` only.
- `:2322-2432` — `systemPrompt`; omitted = minimal default.
- `:1437-1462` — `ModelUsage`, including `costBasis` and the "guess at the
  default model's rate" note.
- `:5737-5748`, `:5841-5852` — `result.usage` and `result.modelUsage` docs.

### Official docs

- Claude Agent SDK, track cost and usage:
  <https://code.claude.com/docs/en/agent-sdk/cost-tracking>
- Claude Agent SDK, modifying system prompts:
  <https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts>
- Claude Code, how prompt caching works:
  <https://code.claude.com/docs/en/prompt-caching>
- Anthropic API, prompt caching:
  <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Claude Code, model configuration and precedence:
  <https://code.claude.com/docs/en/model-config>
- Claude Code, manage costs (`/usage`, cache lines, thinking):
  <https://code.claude.com/docs/en/costs>
- Claude Code, CLI reference:
  <https://code.claude.com/docs/en/cli-reference>
- DeepSeek, Anthropic API compatibility:
  <https://api-docs.deepseek.com/guides/anthropic_api>
- DeepSeek, context caching:
  <https://api-docs.deepseek.com/guides/kv_cache>
- DeepSeek, pricing:
  <https://api-docs.deepseek.com/quick_start/pricing>

### Local observations (machine-specific, not repo files)

- PowerShell environment inspection, 2026-10-19: User
  `ANTHROPIC_MODEL=auto/best-free`, `ANTHROPIC_BASE_URL=http://localhost:20128`,
  `ANTHROPIC_AUTH_TOKEN` set; Process `deepseek-flash[1m]`,
  `https://api.deepseek.com/anthropic`, token set; Machine unset.
- `C:\Users\<you>\.claude\settings.json` — user-level `model:
  "tllm/claude_haiku_3_5"` plus hooks/plugins; no `effort`/`modelSettings`.
- `claude auth status --json` — `authMethod: "oauth_token"`,
  `apiProvider: "firstParty"`.
- Six recent transcripts under `C:\Users\<you>\.claude\projects` — usage
  aggregates in §2.2 and the exact `modelUsage` cost reproductions in §3.2.
  Only `.message.model`, `.message.usage.*`, `modelUsage.*` were read; no prompt
  content was printed.
