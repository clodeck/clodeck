# 01: Monorepo & tooling scaffold

**What to build:** One command at the repo root installs, builds, and tests all three packages together, so a contributor never touches per-package setup. A strict-TypeScript baseline is shared by every package from day one, and a single test runner covers the whole repo.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `npm install` at the root installs all three workspaces (`server`, `web`, `shared`, scoped `@clodeck/*`) with no per-package steps.
- [x] A single shared `tsconfig.base.json` sets `strict: true` (Node 22); every package extends it and none can opt out of strict.
- [x] `npm run build` at the root type-checks and builds all packages that emit output (`server` + `shared`; `web` builds via Vite).
- [x] Vitest is wired as the single runner; `npm test` at the root runs every package's tests and passes with at least one smoke test.
- [x] Root scripts cover install / dev / build / test as one surface (exact dev command finalized in ticket 05).

## What landed

```
package.json          workspaces: shared, server, web — root scripts: build / typecheck / test / dev
tsconfig.base.json    the strict baseline (target ES2023, module NodeNext, strict + noUncheckedIndexedAccess)
shared/               @clodeck/shared — builds to dist with declarations (ticket 02 fills it in)
server/               @clodeck/server — tsc build, tsx watch in dev, node in prod
web/                  @clodeck/web  — Vite (React 19) build, no emit from tsc
```

- Root `build` runs in dependency order (shared → server → web) because `server` and `web` resolve
  `@clodeck/shared` through its built `exports`. Root `test` and `typecheck` build `shared` first for
  the same reason; per-package runs assume `shared` is built.
- Each emitting package has `tsconfig.json` (whole package incl. tests, `noEmit`) and
  `tsconfig.build.json` (src only → `dist`), so tests are type-checked but never shipped.
- `dev` = shared built once, then `concurrently` runs `server` (tsx watch) and `web` (Vite) — provisional;
  ticket 05 owns the final dev loop (Vite `/api` proxy lands in ticket 04).

## Evidence

```
npm install     → 72 packages, 0 vulnerabilities; node_modules/@clodeck/{shared,server,web} symlinked
npm run build   → shared, server tsc clean; vite built web (15 modules, dist/index.html + assets)
npm run typecheck → all three packages clean
npm test        → shared 1 passed, server 2 passed, web 2 passed
npm run dev     → [web] VITE v8.3.4 ready on http://localhost:5173/ ; [server] clodeck-server (protocol v1)
```

Toolchain versions installed: Node 24.19.0 (>=22.12.0 required), TypeScript 7.0.2, Vitest 5.0.3,
Vite 8.3.4, React 19.3.0.
