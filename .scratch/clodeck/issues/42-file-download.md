# 42: Download a file's real bytes

**What to build:** There is no way to get a file out of the drawer — a viewer that can only show you
things is a dead end. Add a download control to the code column's head, and give it a server route that
streams the file as it is on disk.

**Blocked by:** 36, 37

**Status:** ready-for-agent

- [ ] A download action appears in the code column's head whenever a file is selected and saves the
      file under its own name, with a success toast (37) after the browser hands it off.
- [ ] **The bytes come from the server, not from what is on screen.** The prototype could build a
      `Blob` from the content it was already holding, but in this product a text read is truncated for
      large files and a binary read never returns content at all — so a client-side copy of the viewer's
      text would silently hand back a corrupted or empty file. A `GET` download route streams the raw
      bytes with an attachment disposition and no truncation.
- [ ] The route re-uses the read side's guards exactly: the same path syntax check, the same `realpath`
      containment, the same treatment of an escaping symlink (not served), and a directory or the root
      refused rather than streamed.
- [ ] The filename in the disposition header is escaped, including non-ASCII names, so a file called
      `تست.md` downloads as itself.
- [ ] The response is streamed rather than buffered, so a large file does not sit in memory and the cap
      that governs uploads does not become a download limit by accident.
- [ ] Tests: the route serves the exact bytes of a real temp file from a real sandbox (`200` + headers),
      and `404`/`400` for the escaping symlink, missing file, directory and bad path shape; a web test
      asserts the action builds the right URL for the selected entry.

## Reference

Prototype (client-side Blob, and the header control's placement):
`prototype/variant-a.js:88-97,132`. Current reader and its guards: `shared/src/files.ts:27-29`
(`FileContent` truncation and binary shape), `server/src/files/transport.ts` (read routes),
`spec-04` §"path … relative" and its `realpath` containment rule. Parity item: D3 #15.
