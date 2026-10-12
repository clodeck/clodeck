# 45: The code view gets line numbers and rough colour

**What to build:** A file renders as a wall of monochrome `<pre>` text. Bring back the prototype's code
view: a line-number gutter and the rough syntax colouring that made the prototype readable — the
finishing piece that makes download (42) and preview (43) feel like a real viewer.

**Blocked by:** 36

**Status:** ready-for-agent

- [ ] A line-number gutter runs down the code column, aligned to the text, out of the selection, and it
      scrolls with the content rather than staying fixed to the viewport.
- [ ] Source mode stops soft-wrapping: lines that overflow scroll horizontally, which is what keeps the
      gutter aligned with a line's content.
- [ ] Lines are coloured by language from the extension (a small extension→language map; unknown
      extensions render plain), colouring comments, strings, keywords and numbers — the prototype's
      deliberately rough pass, not a parser.
- [ ] The highlight colours are palette tokens added to `index.css` beside the existing ones, taken from
      the prototype's class set, not literals scattered in the component.
- [ ] **Colouring must not become an HTML injection point.** Escaping happens first and the coloured
      segments are React elements; nothing in the viewer sets `innerHTML` or
      `dangerouslySetInnerHTML` — `spec-04` pins file content to text-node rendering, and that pin is
      not weakened by prettier output.
- [ ] A truncated file is highlighted as far as it goes, with today's truncation note still shown.
- [ ] If 43 has landed, the gutter and colouring apply only to source mode — preview is formatted
      markdown, which has no line numbers.
- [ ] Tests: the highlighter is pure (`line + language → segments`) and unit-tested over a comment /
      string / keyword / number sample plus an input containing markdown-ish or script-ish text that must
      come out escaped; a rendered test asserts a gutter line count matching the file.

## Reference

Prototype: `prototype/common.js:97-119` (`highlight`, `KW`) and the line gutter at `:99-119`;
`prototype/styles.css` class set (`.c-com`, `.c-str`, `.c-kw`, `.c-num`). Parity item: P2 #24 — the only
P2 item selected for ticketing.
