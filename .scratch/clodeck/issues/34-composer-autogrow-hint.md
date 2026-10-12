# 34: The composer grows with what you type, and says how to send

**What to build:** The prompt box is a fixed two-row textarea: a long prompt scrolls inside a small box,
and nothing tells the reader that Enter sends and Shift+Enter makes a newline. Make it grow with its
content up to a ceiling, and put the hint under it.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] The textarea grows with its content from its current two rows up to roughly 160px, then scrolls
      — no manual resize handle, no layout jump for the transcript above it.
- [ ] A hint line under the composer reads `Enter to send · Shift+Enter for a newline`. This is
      documentation of behaviour that already exists (`ChatPanel`'s `Composer` sends on Enter without
      Shift), so the ticket adds no new key handling — it may not ship a hint that lies.
- [ ] The hint is present in the connecting state too, where the textarea is disabled and the
      placeholder says `Connecting…`.
- [ ] Sending clears the box and returns it to its minimum height.
- [ ] A rendered test covers growth (a multi-line value grows the box) and the collapse after send.

## Reference

Prototype composer: `prototype/common.js:216-241`, `prototype/styles.css:153-173`. Current composer:
`web/src/chat/ChatPanel.tsx:320-364`.
