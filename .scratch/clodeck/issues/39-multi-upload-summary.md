# 39: Uploading several files reports one honest summary

**What to build:** Picking or dropping several files fires one request per file and any failure stomps
a single shared notice, so a five-file drop that lost two looks like a five-file drop. Keep the requests
independent — one bad file must not abort the rest — and report the outcome once, as counts.

**Blocked by:** 36, 37

**Status:** resolved

- [x] Selecting or dropping N files uploads all of them; a failure on one still lets the others finish.
- [x] When the batch settles, exactly one toast reports it: `N uploaded` on a clean run, and on a mixed
      run the added count alongside the failed count (`3 uploaded · 2 failed`), with the first failure's
      reason available on the message rather than swallowed.
- [x] Too-large files rejected by 38's client check are counted with the failures in the same summary
      instead of producing their own message.
- [x] The listing re-lists once for the batch, and shows everything that landed — a partial failure
      leaves the directory in its real state, not an error state.
- [x] A single-file upload still reads naturally (`1 uploaded`, or the file's name), so the common case
      does not become a count.
- [x] Tests: N successes produce one summary toast; a mixed batch produces the split counts and still
      re-lists.

**Landed as:** `useFiles.upload` takes a batch, settles it independently and re-lists once;
`summarizeUploads` in `web/src/files/upload.ts` folds the outcomes into one message; the toast grew a
second line (`detail`) so the first reason is readable rather than swallowed. The old inline error notice
in the panel's tree column is gone — uploads report through the toast alone now, which is what "exactly
one message" costs. Driven in a real browser: a two-file drop that lost one said `1 uploaded · 1 failed`
over `409 Conflict: already exists` (`.scratch/clodeck/evidence/39-mixed-batch-toast.png`).

## Reference

Prototype summary: `prototype/common.js:611-623` (`N uploaded · k too large`). Current loop:
`web/src/files/FilePanel.tsx:39-45`. Parity item: P1 #21.
