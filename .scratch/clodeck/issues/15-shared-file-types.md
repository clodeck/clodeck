# 15: Shared file types — FileEntry / FileContent

**What to build:** The wire shapes the file drawer serves and renders, declared once in `shared` so server and web cannot drift: `FileEntry` (one directory-listing row) and `FileContent` (one file preview), both discriminated unions. This is the contract the later tickets hang off, exactly as `session.ts` was for history.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `shared/src/files.ts` declares `FileEntry` and `FileContent` as discriminated unions (no optional-field soup, every arm carries exactly its own fields).
- [x] `FileEntry = { type:'file'; name; size; mtime } | { type:'directory'; name } | { type:'symlink'; name }`.
- [x] `FileContent = { kind:'text'; content; truncated; size } | { kind:'binary'; size }`.
- [x] Re-exported from `shared/src/index.ts` (so `@clodeck/shared` exposes them).
- [x] `protocol.ts` is untouched — these are REST shapes, not envelope kinds.
- [x] `npm run typecheck` passes; the existing `shared` test still green.

## What landed

```
shared/src/files.ts     FileEntry / FileContent, both discriminated unions
shared/src/index.ts     re-exports files.ts (and the module doc lists it)
shared/src/index.test.ts  one new test: "is the single source of the file-drawer shapes"
```

## Evidence

```
npm run build:shared && npm run test --workspace @clodeck/shared  →  8 passed
```
