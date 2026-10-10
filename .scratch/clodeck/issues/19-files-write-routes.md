# 19: Files write routes — create / rename / delete / upload

**What to build:** The write half of the file REST surface, added to the same `/api` scope: `POST /files` (create file or directory), `POST /files/rename`, `DELETE /files`, and `PUT /files/content` (upload). Every write addresses its target by a single relative `?path=`, goes through `resolveWriteTarget`, and maps a `WriteResult` to a status code.

**Blocked by:** 17, 18

**Status:** resolved

- [x] `registerFileRoutes` gains the four write routes (same module as the reads).
- [x] `POST /projects/:id/files?path=` body `{ kind: 'file' | 'directory' }` → `201`; existing → `409`; symlink-in-final-segment → `400`.
- [x] `POST /projects/:id/files/rename?path=` body `{ to: string }` → `200`; bad `to` → `400`; missing → `404`.
- [x] `DELETE /projects/:id/files?path=` → `200`; missing → `404`; root → `400`.
- [x] `PUT /projects/:id/files/content?path=` (raw octet-stream body) → `201` and the bytes land on disk; body capped at 200 MiB (`bodyLimit`, over → `413`).
- [x] Malformed bodies → `400`; unknown project / outside-root / not-found → `404`.
- [x] Inject tests assert every code and that bytes actually land inside the project root (and never outside it).

## What landed

```
server/src/files/transport.ts       four write routes; MAX_UPLOAD_BYTES; octet-stream content-type parser; writeRelPath / readKind / readTo / targetFailed / writeOutcome
server/src/files/transport.test.ts  23 inject() tests over the write routes (22 run, 1 POSIX-only symlink skip)
```

- `POST /files`, `POST /files/rename`, `DELETE /files`, `PUT /files/content` are added to `registerFileRoutes`; `app.ts` is unchanged (the four land in the same `/api` scope as the reads).
- Writes are **not** run through `readRelPath`: per spec-04 §"readRelPath", the write door (`resolveWriteTarget` + `name`) is their syntax check. So a `..` basename is `invalid_name` → 400 while an *escaping* parent is `outside_root` → 404, folded into the same 404 as any other miss.
- `targetFailed` maps `WriteTargetResult` (`is_root`/`invalid_name`/`not_a_directory` → 400; `not_found`/`outside_root` → 404) and `writeOutcome` maps `WriteResult` (`ok` → the caller's 201/200; `exists` → 409; `symlink` → 400; `not_found` → 404) — the two unions the spec asks to map separately.
- A raw upload needs a content-type parser: `registerFileRoutes` registers `application/octet-stream` as a buffer parser, and the route carries `bodyLimit: MAX_UPLOAD_BYTES` (200 MiB) so an over-cap body is a Fastify 413. A missing or non-buffer body is a 400.
- Successful writes answer `{ ok: true }` (matching the terminal-size route's envelope); refusals use the `{ error: string }` envelope of `sessions.ts`/`terminal/transport.ts`.

## Evidence

```
npm run typecheck --workspace @clodeck/server                  →  clean
npm run test --workspace @clodeck/server -- --run src/files    →  62 passed | 4 skipped (2 files)
npm run test --workspace @clodeck/server                       →  169 passed | 5 skipped (14 files)
```

(Pre-ticket baseline was 147 passed | 4 skipped: +22 passed and +1 skipped, exactly the 23 new write-route tests — the skip is the `it.skipIf(win32)` create-through-escaping-symlink guard.)
