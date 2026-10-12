# 39: Uploading several files reports one honest summary

**What to build:** Picking or dropping several files fires one request per file and any failure stomps
a single shared notice, so a five-file drop that lost two looks like a five-file drop. Keep the requests
independent — one bad file must not abort the rest — and report the outcome once, as counts.

**Blocked by:** 36, 37

**Status:** ready-for-agent

- [ ] Selecting or dropping N files uploads all of them; a failure on one still lets the others finish.
- [ ] When the batch settles, exactly one toast reports it: `N uploaded` on a clean run, and on a mixed
      run the added count alongside the failed count (`3 uploaded · 2 failed`), with the first failure's
      reason available on the message rather than swallowed.
- [ ] Too-large files rejected by 38's client check are counted with the failures in the same summary
      instead of producing their own message.
- [ ] The listing re-lists once for the batch, and shows everything that landed — a partial failure
      leaves the directory in its real state, not an error state.
- [ ] A single-file upload still reads naturally (`1 uploaded`, or the file's name), so the common case
      does not become a count.
- [ ] Tests: N successes produce one summary toast; a mixed batch produces the split counts and still
      re-lists.

## Reference

Prototype summary: `prototype/common.js:611-623` (`N uploaded · k too large`). Current loop:
`web/src/files/FilePanel.tsx:39-45`. Parity item: P1 #21.
