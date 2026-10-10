# 19: Files write routes — create / rename / delete / upload

**What to build:** The write half of the file REST surface, added to the same `/api` scope: `POST /files` (create file or directory), `POST /files/rename`, `DELETE /files`, and `PUT /files/content` (upload). Every write addresses its target by a single relative `?path=`, goes through `resolveWriteTarget`, and maps a `WriteResult` to a status code.

**Blocked by:** 17, 18

**Status:** ready

- [ ] `registerFileRoutes` gains the four write routes (same module as the reads).
- [ ] `POST /projects/:id/files?path=` body `{ kind: 'file' | 'directory' }` → `201`; existing → `409`; symlink-in-final-segment → `400`.
- [ ] `POST /projects/:id/files/rename?path=` body `{ to: string }` → `200`; bad `to` → `400`; missing → `404`.
- [ ] `DELETE /projects/:id/files?path=` → `200`; missing → `404`; root → `400`.
- [ ] `PUT /projects/:id/files/content?path=` (raw octet-stream body) → `201` and the bytes land on disk; body capped at 200 MiB (`bodyLimit`, over → `413`).
- [ ] Malformed bodies → `400`; unknown project / outside-root / not-found → `404`.
- [ ] Inject tests assert every code and that bytes actually land inside the project root (and never outside it).
