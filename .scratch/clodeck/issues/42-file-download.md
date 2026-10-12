# 42: Download a file's real bytes

**What to build:** There is no way to get a file out of the drawer — a viewer that can only show you
things is a dead end. Add a download control to the code column's head, and give it a server route that
streams the file as it is on disk.

**Blocked by:** 36, 37

**Status:** resolved

- [x] A download action appears in the code column's head whenever a file is selected and saves the
      file under its own name, with a success toast (37) after the browser hands it off.
- [x] **The bytes come from the server, not from what is on screen.** The prototype could build a
      `Blob` from the content it was already holding, but in this product a text read is truncated for
      large files and a binary read never returns content at all — so a client-side copy of the viewer's
      text would silently hand back a corrupted or empty file. A `GET` download route streams the raw
      bytes with an attachment disposition and no truncation.
- [x] The route re-uses the read side's guards exactly: the same path syntax check, the same `realpath`
      containment, the same treatment of an escaping symlink (not served), and a directory or the root
      refused rather than streamed.
- [x] The filename in the disposition header is escaped, including non-ASCII names, so a file called
      `تست.md` downloads as itself.
- [x] The response is streamed rather than buffered, so a large file does not sit in memory and the cap
      that governs uploads does not become a download limit by accident.
- [x] Tests: the route serves the exact bytes of a real temp file from a real sandbox (`200` + headers),
      and `404`/`400` for the escaping symlink, missing file, directory and bad path shape; a web test
      asserts the action builds the right URL for the selected entry.

**Landed as:** `GET /api/projects/:id/files/download?path=` in `server/src/files/transport.ts`,
which resolves through the same door as `/files` and `/files/content` (all three now share
`resolveAs`: a bad path a 400 from `relPath` before the reader, a miss or an escaping symlink a 404,
a directory — and so the root — a 400) and then streams through the one method `ScopedFs` grew for
it, `readStream`. `attachment()` writes the disposition both ways: an ASCII `filename` and an RFC 5987
`filename*`, so `تست.md` downloads as itself. The web side is the code head's `Download` anchor —
outside the per-kind switch, since a selectable file is downloadable whatever its bytes turned out to
be — with `downloadUrl` beside the other URL builders. `web/e2e/file-download.spec.ts` proves the
whole path in Chrome: a Persian-named upload, the real link, the browser's own
`suggestedFilename()`, and the saved bytes compared with what went up.

**Known limit, deliberate:** the toast fires on the click, not on the bytes landing — a page is told
nothing about a download finishing, so `downloaded x` means the browser took it. A deleted file still
toasts (and the browser will save the 404 body under that name); tightening this would cost a request
per download for a message that is still a guess.

## Reference

Prototype (client-side Blob, and the header control's placement):
`prototype/variant-a.js:88-97,132`. Current reader and its guards: `shared/src/files.ts:27-29`
(`FileContent` truncation and binary shape), `server/src/files/transport.ts` (read routes),
`spec-04` §"path … relative" and its `realpath` containment rule. Parity item: D3 #15.
