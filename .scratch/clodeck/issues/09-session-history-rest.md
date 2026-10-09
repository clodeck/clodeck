# 09: Session history REST

**What to build:** Two REST endpoints expose per-project session history and transcripts, normalized through the provider.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] `GET /api/projects/:id/sessions` returns `200 { sessions: SessionSummary[] }`, ordered by `lastModified` descending.
- [ ] `GET /api/projects/:id/sessions/:sid/messages` returns `200 { messages: SessionMessage[] }` with complete content blocks only (no `stream_event`), no pagination.
- [ ] The `:id` is canonicalized against the allowlist before use — never treated as a raw path.
- [ ] The list uses the provider's title fallback, and the transcript reuses the shared `ContentBlock` types, so live and history share one block renderer.
- [ ] The endpoints are tested against the fake provider through the HTTP boundary for exact envelope shape (list title-fallback, transcript complete blocks).
