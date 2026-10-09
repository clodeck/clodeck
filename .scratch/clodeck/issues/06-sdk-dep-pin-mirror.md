# 06: SDK dependency, mirror pin, and mirror widening

**What to build:** The Agent SDK becomes a dependency of the server alone, and the structural mirror in shared is pinned to the real SDK types at compile time. A server-side narrowing function assigns the real `SDKMessage` union to the mirrored families, so `tsc` proves the mirror is wide enough; where the SDK is genuinely wider, the mirror is widened (never with `any`, never with SDK types in shared, never by changing the envelope).

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] `@anthropic-ai/claude-agent-sdk` is a dependency of `server` only — never `shared` or `web` — with an exact version pin (latest, per the wayfinder research's v0.3.292 reference).
- [x] A server module imports the real SDK and narrows its message union to the mirrored families (`system`/`assistant`/`user`/`tool_progress`/`stream_event`/`result`), returning the mirrored message or `null` for unmirrored families.
- [x] The pin compiles: assigning a real `SDKMessage` to the shared mirror type-checks under `strict`.
- [x] Where the real SDK is wider than the mirror (e.g. a structured `assistant.error`, `uuid`/`UUID`), the mirror is widened with `unknown` or a structural type — no `any`, no SDK types leak into `shared`, no envelope change.
- [x] `shared` still has no SDK dependency, and the existing shared test that pins that holds.
- [x] `npm run typecheck` is clean across all three packages with the pin in place.

## What landed

```
server/package.json          "@anthropic-ai/claude-agent-sdk": "0.3.296"  — server-only, exact pin
server/src/sdk/mirror.ts     narrowToMirror(real SDKMessage): SDKMessage | null   — the pin
server/src/sdk/mirror.test.ts  runtime dispatch: which family becomes which, which fall away
shared/src/sdk.ts            UserApiMessage.role widened to include 'system'
```

- The pin is **type-only**: `import type { SDKMessage as RealSDKMessage } from '@anthropic-ai/claude-agent-sdk'`
  is the only import, so the assignment is checked at compile time and `tsc` erases it — the emitted
  `server/dist/sdk/mirror.js` carries no import at all, and the SDK's native binary never reaches
  another package. `shared` and `web` declare no `@anthropic-ai/*` dependency, and the existing
  `shared/src/index.test.ts` case ("keeps the Anthropic SDKs out of the contract package") still holds.
- Six top-level families reach a mirrored arm (`assistant`, `user`, `tool_progress`, `stream_event` are
  direct `return message`; `system` and `result` go to a helper each); every other `type` falls to
  `default` and returns `null`, so an unrendered family can never leak through as a mirror message.
- **The annotated-target trick.** `system` and `result` discriminate a second level on `subtype`. The
  `system` helper does *not* return straight into the union: the mirror's catch-all
  `SDKSystemOtherMessage` types `subtype` as `string` (and needs only `type`/`session_id`), so it would
  absorb *any* `system` message and a plain `return message` would pin nothing beyond the top-level
  discriminant. Each of the three named arms instead assigns to an **annotated** local
  (`const mirrored: SDKSystemInitMessage = message`) and returns that — the annotation is what pins the
  arm's real shape (a required `cwd`/`model`/`permissionMode`/`tools`, a narrowed `status`/`state`). A
  fourth named arm must be annotated the same way. `result` splits `success` from the error subtypes the
  same way, pinning the success arm to the mirror arm that requires `result: string` and the error arms
  to the one that requires `errors: string[]`.
- **The one widening.** The only place the real SDK was wider than the mirror is
  `UserApiMessage.role`: the API's `MessageParam.role` is `'user' | 'assistant' | 'system'`, and a real
  `user` SDK message can carry any of the three, so the mirror now lists `'system'` too. No `any`
  anywhere, no SDK type imported into `shared`, and `shared/src/protocol.ts` (the envelope) is
  byte-identical to its parent commit.

## Evidence

Run at the integration tip (`clodeck/06-11-chat-transport`, after `npm install`):

```
npm run typecheck → clean (shared build + typecheck of shared, server, web)
npm test          → shared: 6 passed (1 file); server: 22 passed | 1 skipped (23);
                    web: 2 passed (1 file)
npm run build     → clean (shared + server tsc, web tsc + vite: 18 modules, built in 99ms)
```

The one skipped server test is ticket 03's POSIX-only symlink-to-a-file case; nothing here is skipped.
The suite needs no API key and no network — no test under `server/src` references `ANTHROPIC_API_KEY`,
`fetch`, or any URL; `narrowToMirror` is pure and its tests import only the emitted module.

Checked by hand, not taken on trust:

```
git show --stat HEAD          → only server/package.json, package-lock.json, server/src/sdk/mirror.ts,
                                server/src/sdk/mirror.test.ts, shared/src/sdk.ts
git diff HEAD~1 HEAD -- shared/src/protocol.ts   → empty (byte-identical)
grep @anthropic-ai shared/package.json web/package.json → no match
server/package.json           → "@anthropic-ai/claude-agent-sdk": "0.3.296"  (exact; no ^ / ~)
server/dist/sdk/mirror.js     → no import / require statement (type import erased)
grep claude-agent-sdk server/dist → only mirror.d.ts (a type declaration, expected)
grep ': any' / 'as any' server/src/sdk/mirror.ts shared/src/sdk.ts → none
```
