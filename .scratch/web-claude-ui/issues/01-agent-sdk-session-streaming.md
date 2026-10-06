# 01 — Agent SDK session, streaming and resume model

Type: research
Status: resolved

## Question

What exactly does the TypeScript Agent SDK expose for: creating a session bound to a working directory (cwd), streaming message/tool/result events to a client, and resuming/forking a session later? What is the concrete event shape a chat UI should consume? (Primary source: the Agent SDK docs + TypeScript reference.)

## Answer

Everything flows through one function: **`query({ prompt, options })`** from **`@anthropic-ai/claude-agent-sdk`** (returns a `Query`, an `AsyncGenerator<SDKMessage>`).

- **(a) Session bound to cwd** — set `options.cwd` (default `process.cwd()`); widen access with `options.additionalDirectories`. A single `query()` call runs the whole agent loop.
- **(b) Streaming** — `for await` the `SDKMessage` union and forward to the browser. Enable `options.includePartialMessages: true` to also get `type: 'stream_event'` (raw `text_delta` / `input_json_delta` chunks). Core types: `system`(init) → `assistant` (one content block each: text/tool_use/thinking) → `user` (tool results) → `tool_progress` → `result` (turn complete: `result`, `total_cost_usd`, `session_id`, `subtype`).
- **(c) Resume/fork** — capture `session_id` (on the `init` system message or any result). Later pass `options.resume = sessionId`, or `resume + forkSession: true` to branch, or `continue: true` for the latest session in that dir. Transcripts persist at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`; `options.sessionStore` mirrors them for cross-host resume. Helpers: `listSessions()`, `getSessionMessages()`, `getSessionInfo()`, `renameSession()`, `tagSession()`.
- **Approval surfaces** — `options.canUseTool` (callback returning `{ behavior: 'allow'|'deny', updatedInput?, updatedPermissions?, message? }`) handles permission prompts and `AskUserQuestion` clarifying questions; `permissionMode` + `allowedTools`/`disallowedTools` + `hooks` gate the rest.

Full findings (entry points, exact type shapes, renderer mapping, sources): [research/01-agent-sdk-session-streaming.md](../research/01-agent-sdk-session-streaming.md)
