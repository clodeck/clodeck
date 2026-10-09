# 06: SDK dependency, mirror pin, and mirror widening

**What to build:** The Agent SDK becomes a dependency of the server alone, and the structural mirror in shared is pinned to the real SDK types at compile time. A server-side narrowing function assigns the real `SDKMessage` union to the mirrored families, so `tsc` proves the mirror is wide enough; where the SDK is genuinely wider, the mirror is widened (never with `any`, never with SDK types in shared, never by changing the envelope).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `@anthropic-ai/claude-agent-sdk` is a dependency of `server` only — never `shared` or `web` — with an exact version pin (latest, per the wayfinder research's v0.3.292 reference).
- [ ] A server module imports the real SDK and narrows its message union to the mirrored families (`system`/`assistant`/`user`/`tool_progress`/`stream_event`/`result`), returning the mirrored message or `null` for unmirrored families.
- [ ] The pin compiles: assigning a real `SDKMessage` to the shared mirror type-checks under `strict`.
- [ ] Where the real SDK is wider than the mirror (e.g. a structured `assistant.error`, `uuid`/`UUID`), the mirror is widened with `unknown` or a structural type — no `any`, no SDK types leak into `shared`, no envelope change.
- [ ] `shared` still has no SDK dependency, and the existing shared test that pins that holds.
- [ ] `npm run typecheck` is clean across all three packages with the pin in place.
