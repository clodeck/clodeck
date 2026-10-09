# 10: Web chat, streaming renderer, and approval modal

**What to build:** The chat stub becomes a live streaming chat surface over the `/ws` bus: tokens appear incrementally, tool activity is visible, and gated tools surface an approval modal.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] A chat data seam opens a WebSocket to `/ws?projectId=…`, reconnects with backoff, rebuilds state from `snapshot` on (re)connect, and accumulates `sdk` events; control messages are typed from the shared `ClientMessage`.
- [ ] Tokens appear incrementally: `stream_event` deltas accumulate into a text bubble, reconciled by complete `assistant` blocks.
- [ ] The renderer maps `tool_use` → tool card, `tool_result` → collapsed, `thinking` → collapsible, `tool_progress` → "Using …", `result` → done + cost; `parent_tool_use_id` nests subagent frames, and unknown kinds are ignored.
- [ ] An approval modal shows the tool's title/displayName/description and input, with Allow/Deny; the client answers with `approval_response` (Allow/Deny only for the MVP).
- [ ] A composer sends `send_prompt`, and an interrupt action sends `interrupt`.
- [ ] Sending a prompt while a turn is running surfaces the server's `turn_in_progress` error rather than double-driving the model.
- [ ] Control messages are typed from the shared envelope, so a contract change breaks the client at compile time.
