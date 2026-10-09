# 01: Monorepo & tooling scaffold

**What to build:** One command at the repo root installs, builds, and tests all three packages together, so a contributor never touches per-package setup. A strict-TypeScript baseline is shared by every package from day one, and a single test runner covers the whole repo.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `npm install` at the root installs all three workspaces (`server`, `web`, `shared`, scoped `@clodeck/*`) with no per-package steps.
- [ ] A single shared `tsconfig.base.json` sets `strict: true` (Node 22); every package extends it and none can opt out of strict.
- [ ] `npm run build` at the root type-checks and builds all packages that emit output (`server` + `shared`; `web` builds via Vite).
- [ ] Vitest is wired as the single runner; `npm test` at the root runs every package's tests and passes with at least one smoke test.
- [ ] Root scripts cover install / dev / build / test as one surface (exact dev command finalized in ticket 05).
