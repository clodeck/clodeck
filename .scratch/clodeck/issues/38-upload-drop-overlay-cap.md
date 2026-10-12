# 38: Dropping files shows where they land, and the size cap is known before the request

**What to build:** Dropping files onto the drawer works, but the drawer never reacts: no highlight, no
target, no hint that there is a 200 MiB ceiling. The ceiling is only enforced server-side as a `413`, so
a 300 MB drop uploads for a while and then fails. Show the drop target, and check the size in the
client before anything is sent.

**Blocked by:** 36

**Status:** resolved

- [x] Dragging OS files over the file panel shows a drop overlay reading `Drop files to upload · max
      200 MB` with the target area highlighted; it clears on drag-leave and on drop. Dragging anything
      that is not an OS file (a tree row being dragged for a move) must not trigger it.
- [x] The 200 MiB cap gets **one** home shared by both sides: the constant moves into `@clodeck/shared`
      and is imported by the upload route's body limit and by the client's pre-check, so the overlay's
      number and the server's `413` cannot drift.
- [x] A file over the cap is rejected in the client without a request being made, and reported the way
      upload failures are reported today (ticket 37's surface is the natural home for it).
- [x] The server's `413` stays as the backstop for a request that bypasses the client check; this ticket
      removes the round trip, not the guard.
- [x] Tests: an oversize file produces no request (transport-level assertion); the route test for `413`
      still passes after the constant moves.

**Landed as:** the overlay and the guards are in `web/src/files/FilePanel.tsx` (one drop target on the
whole panel, `hasOsFiles` as the gate) and `web/src/files/upload.ts` (`exceedsUploadCap`); the constant
is `MAX_UPLOAD_BYTES`/`MAX_UPLOAD_MB` in `shared/src/files.ts`, imported by `server/src/files/transport.ts`
and by the client. Driven in a real browser on the installed Chrome: the overlay appears on an OS-file
drag and clears on drag-leave (`.scratch/clodeck/evidence/38-drop-overlay.png`).

## Reference

Prototype overlay and cap: `prototype/common.js:373-381`, cap passed as `maxUploadMB`. Current cap:
`server/src/files/transport.ts:23` (`MAX_UPLOAD_BYTES`), body limit at `:110,132`. Parity item: P1 #20.
