# 09: Session history REST

**What to build:** Two REST endpoints expose per-project session history and transcripts, normalized through the provider.

**Blocked by:** 07

**Status:** resolved

- [x] `GET /api/projects/:id/sessions` returns `200 { sessions: SessionSummary[] }`, ordered by `lastModified` descending.
- [x] `GET /api/projects/:id/sessions/:sid/messages` returns `200 { messages: SessionMessage[] }` with complete content blocks only (no `stream_event`), no pagination.
- [x] The `:id` is canonicalized against the allowlist before use — never treated as a raw path.
- [x] The list uses the provider's title fallback, and the transcript reuses the shared `ContentBlock` types, so live and history share one block renderer.
- [x] The endpoints are tested against the fake provider through the HTTP boundary for exact envelope shape (list title-fallback, transcript complete blocks).

## What landed

```
server/src/sessions.ts        registerSessionRoutes(api, { projects, provider }) — the two routes + the ordering comparator + the one 404 body
server/src/sessions.test.ts   the HTTP-boundary suite (six cases), fake provider, real discovery over a temp root
server/src/app.ts             2 lines: import + registerSessionRoutes(api, …) inside the existing /api scope
```

- `GET /api/projects/:id/sessions` → `200 { sessions: SessionSummary[] }`. The route asks
  `provider.listSessions(project.path)` and sorts the result itself, so the order is the
  **endpoint's** behavior, not a property of whichever provider is plugged in.
- `GET /api/projects/:id/sessions/:sid/messages` → `200 { messages: SessionMessage[] }`. No
  pagination and no reshaping: the provider already drops the SDK's `system` rows and hands back
  complete blocks (never `stream_event`), and the route passes them through. An `sid` the provider
  does not know is a normal read — `200 { messages: [] }` — not an error.
- **Ordering rule** (`byLastModifiedDesc`): `lastModified` descending, with a missing timestamp after
  every session that has one; `Array.prototype.sort` is stable, so sessions with equal keys — and two
  sessions that both lack a timestamp — keep the provider's order. ISO 8601 compares
  lexicographically in chronological order, so the comparator is `a < b ? 1 : -1`.
- **404 rule**: both routes re-enter through `projects.resolveProject(id)` — the discovery seam —
  which decodes the id, re-validates through the allowlist and requires a directory. A non-resolving
  id is `404 { error: 'no allowlisted project matches this id' }` — the server's one REST error shape,
  nothing else. Decoding an id is never authorization. The route never decodes a path itself and
  never touches the filesystem.
- **Registration**: both routes are registered into the app's own `/api` encapsulated Fastify scope
  (the same `register(…, { prefix: '/api' })` block that serves `/api/projects`), so wayfinder 07's
  principal-aware auth hook drops in front of them with no rework.
- Nothing re-derives or drops a title: the provider's normalized title — including the `"Untitled"`
  fallback — reaches the client unchanged.

## Evidence

```
npm run typecheck → clean (shared → server → web, no diagnostics)
npm test          → shared 7 passed; server 72 passed | 1 skipped; web 2 passed
npm run build     → clean (tsc for shared/server, tsc + vite build for web; 18 modules, built)
```

No test needs an API key or the network: the suite drives `buildApp` through `inject()` against the
scripted fake provider, and the SDK is never imported on that path. The one skipped test is unchanged
from ticket 03 — the symlink-to-a-file case, which needs elevation or Developer Mode on Windows
(`it.skipIf(win32)`).

**TDD caveat (honest):** the envelope test (`GET …/sessions` shape) and the transcript-route test were
genuinely red-first. The **ordering** test and the **404-body** test passed on their first run rather
than starting red, because the behavior was written into the first implementation. They are real
regression pins — they fail if the comparator or the error body changes — but they were not a
red-first cycle. Recorded here rather than hidden; not a failure.

Independent checks by the merger (not the implementer's word):

```
git show --stat cf23c11 → server/src/app.ts (+2), server/src/sessions.test.ts (+179), server/src/sessions.ts (+65)
                          — nothing under shared/, web/, server/src/ws/ or protocol.ts
git diff cf23c11^ cf23c11 -- shared/src/protocol.ts   → empty (byte-identical to the pre-09 tip)
```

Live run against the fake provider (`PROJECTS_ROOT=<temp> PORT=3199 npx tsx src/testing/dev-fake.ts`):

```
GET /api/projects/:id/sessions           → 200 {"sessions":[{"id":"…","title":"A fake session","lastModified":"1970-01-01T00:00:00.000Z"}]}
GET /api/projects/:id/sessions/:sid/messages → 200 {"messages":[{"role":"user","content":[{"type":"text","text":"hello"}]}, …]}
GET /api/projects/BOGUS/sessions         → 404 {"error":"no allowlisted project matches this id"}
```

Routes confirmed inside the `/api` scope by reading `server/src/app.ts` (registered inside the
`register(async (api) => { … }, { prefix: '/api' })` callback, alongside `/api/projects`).
